/**
 * Admin login hardening: lockouts, a 6-digit code by mail (2FA) and trusted devices.
 *
 * Password   5 wrong per email in 15 min -> locked 15 min; the next lock within 24 h -> 1 h.
 *            Per IP: 20 wrong in 15 min -> 1 h, only for public IPs (see isPublicIp). A correct
 *            password resets the email counter.
 * Mail code  6 digits, 10 min valid, single use. 3 wrong -> that code is void (send a new one).
 *            10 wrong per account within 1 h -> account locked 1 h.
 *            Max 5 code mails per hour, 1 minute between resends.
 * Devices    "remember this device" skips the code (never the password) for 30 days, and the
 *            account/IP lock: a remembered browser can still log in while someone else locked the
 *            account. Such a device has its own counter: 5 wrong passwords -> it is forgotten (with
 *            a warning mail) and the normal rules apply again.
 * Every lock sends a warning mail: an account lock to that account, an IP lock (not tied to one
 * account) to every admin account.
 *
 * All counters live in Postgres (auth_throttle), so a deploy or restart doesn't reset them.
 */
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb } from "./db.ts";
import { adminUsers, authThrottle, loginChallenges, trustedDevices, type AdminUser } from "./schema.ts";
import { sha256, verifyLogin } from "./auth.ts";
import { escapeHtml, sendMail } from "./mail.ts";

const MIN = 60 * 1000;

export const CHALLENGE_COOKIE = "fgb_2fa";
export const TRUSTED_COOKIE = "fgb_device";
export const TRUSTED_DAYS = 30;
export const CODE_TTL_MS = 10 * MIN;
export const CHALLENGE_TTL_MS = 30 * MIN;
export const RESEND_COOLDOWN_MS = 1 * MIN;
export const MAX_CODE_ATTEMPTS = 3;

interface Rule {
  max: number;
  windowMs: number;
  /** lock duration for the n-th lock within 24 h (n starts at 1) */
  lockMs: (level: number) => number;
}

const RULES = {
  password: { max: 5, windowMs: 15 * MIN, lockMs: (level) => (level <= 1 ? 15 * MIN : 60 * MIN) },
  passwordIp: { max: 20, windowMs: 15 * MIN, lockMs: () => 60 * MIN },
  code: { max: 10, windowMs: 60 * MIN, lockMs: () => 60 * MIN },
  mail: { max: 5, windowMs: 60 * MIN, lockMs: () => 0 },
} satisfies Record<string, Rule>;

// ---------------------------------------------------------------------------
// throttle primitives
// ---------------------------------------------------------------------------

/** the time a key is locked until, or null */
async function lockedUntil(key: string): Promise<Date | null> {
  const [row] = await getDb()
    .select({ lockedUntil: authThrottle.lockedUntil })
    .from(authThrottle)
    .where(eq(authThrottle.key, key));
  return row?.lockedUntil && row.lockedUntil > new Date() ? row.lockedUntil : null;
}

/** counts one event in the key's rolling window and returns the count (atomic) */
async function hit(key: string, windowMs: number): Promise<number> {
  const expired = sql`${authThrottle.windowStart} < now() - ${windowMs / 1000} * interval '1 second'`;
  const [row] = await getDb()
    .insert(authThrottle)
    .values({ key, failures: 1 })
    .onConflictDoUpdate({
      target: authThrottle.key,
      set: {
        failures: sql`CASE WHEN ${expired} THEN 1 ELSE ${authThrottle.failures} + 1 END`,
        windowStart: sql`CASE WHEN ${expired} THEN now() ELSE ${authThrottle.windowStart} END`,
      },
    })
    .returning({ failures: authThrottle.failures });
  return row.failures;
}

/** locks a key; escalates when it was locked before within 24 h */
async function lock(key: string, rule: Rule): Promise<Date> {
  const db = getDb();
  const [row] = await db.select().from(authThrottle).where(eq(authThrottle.key, key));
  const recent = row?.lastLockAt && row.lastLockAt > new Date(Date.now() - 24 * 60 * MIN);
  const level = recent ? (row?.lockLevel ?? 0) + 1 : 1;
  const until = new Date(Date.now() + rule.lockMs(level));
  await db
    .update(authThrottle)
    .set({ lockedUntil: until, lockLevel: level, lastLockAt: new Date(), failures: 0, windowStart: new Date() })
    .where(eq(authThrottle.key, key));
  return until;
}

async function clear(key: string): Promise<void> {
  await getDb().delete(authThrottle).where(eq(authThrottle.key, key));
}

function later(...dates: (Date | null)[]): Date | null {
  return dates.reduce<Date | null>((a, b) => (b && (!a || b > a) ? b : a), null);
}

// ---------------------------------------------------------------------------
// mails
// ---------------------------------------------------------------------------

function timeNl(d: Date): string {
  return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: process.env.ADMIN_TIMEZONE || "Europe/Amsterdam" });
}

function mailLayout(title: string, body: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
  <h1 style="font-size:20px;color:#0f766e">${escapeHtml(title)}</h1>${body}
  <p style="color:#6b7280;font-size:13px;margin-top:24px">Feelgood Brothers admin</p></div>`;
}

async function sendCodeMail(user: AdminUser, code: string): Promise<void> {
  await sendMail({
    to: user.email,
    subject: `Je inlogcode: ${code}`,
    text: `Je inlogcode voor de Feelgood Brothers admin is: ${code}\n\nDeze code is 10 minuten geldig.\nHeb je niet zelf geprobeerd in te loggen? Dan kent iemand je wachtwoord: verander het direct.`,
    html: mailLayout(
      "Je inlogcode",
      `<p>Gebruik deze code om in te loggen op de admin:</p>
  <div style="background:#f3f4f6;padding:20px;text-align:center;margin:20px 0;border-radius:8px">
    <span style="font-size:32px;font-weight:bold;letter-spacing:8px">${code}</span></div>
  <p style="color:#6b7280;font-size:14px">Deze code is 10 minuten geldig.</p>
  <p style="color:#6b7280;font-size:14px">Heb je niet zelf geprobeerd in te loggen? Dan kent iemand je wachtwoord: verander het direct.</p>`,
    ),
  });
}

/** warning mail on a lockout; never throws (a failing mail must not break the login page) */
async function sendLockAlert(user: AdminUser, what: string, until: Date, ip: string): Promise<void> {
  const text = `${what}\n\nDe admin is voor jouw account geblokkeerd tot ${timeNl(until)}.\nIP-adres: ${shownIp(ip)}\n\nWas jij dit niet? Dan probeert iemand in te loggen. ${
    what.includes("code") ? "Diegene kende je wachtwoord: verander het direct." : "Gebruik een sterk, uniek wachtwoord."
  }`;
  await sendMail({
    to: user.email,
    subject: "Let op: mislukte inlogpogingen op de admin",
    text,
    html: mailLayout("Mislukte inlogpogingen", text.split("\n").map((l) => `<p>${escapeHtml(l)}</p>`).join("")),
  }).catch((err) => console.error("[auth] lock alert mail failed:", err));
}

/**
 * True for a real, public client IP. Private, loopback and link-local addresses are never locked:
 * behind a proxy that hides the visitor (e.g. Docker Swarm's ingress mesh, which makes every
 * request come from 10.0.0.x) one lock would shut out everybody.
 */
export function isPublicIp(ip: string): boolean {
  const v = ip.trim().toLowerCase().replace(/^::ffff:/, "");
  if (!v) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) {
    const [a, b] = v.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    return true;
  }
  if (v.includes(":")) return !(v === "::1" || v === "::" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v));
  return false;
}

function shownIp(ip: string): string {
  return isPublicIp(ip) ? ip : "onbekend (achter een proxy)";
}

async function allAdmins(): Promise<AdminUser[]> {
  return getDb().select().from(adminUsers);
}

/**
 * IP lock: it belongs to no single account (the attempts may use unknown or several addresses),
 * so every admin account gets the warning. Never throws.
 */
async function sendIpLockAlert(ip: string, lastEmail: string, until: Date): Promise<void> {
  const tried = lastEmail.trim().slice(0, 120) || "(leeg)";
  const text = `Er zijn ${RULES.passwordIp.max} mislukte inlogpogingen gedaan vanaf IP-adres ${ip} binnen 15 minuten.\n\nDat IP-adres is geblokkeerd tot ${timeNl(until)}.\nLaatst geprobeerde e-mailadres: ${tried}\n\nDit is waarschijnlijk iemand die wachtwoorden probeert te raden. Je hoeft niets te doen; je eigen account is niet geblokkeerd.`;
  for (const admin of await allAdmins().catch(() => [])) {
    await sendMail({
      to: admin.email,
      subject: "Let op: IP-adres geblokkeerd op de admin",
      text,
      html: mailLayout("IP-adres geblokkeerd", text.split("\n").map((l) => `<p>${escapeHtml(l)}</p>`).join("")),
    }).catch((err) => console.error("[auth] IP lock alert mail failed:", err));
  }
}

async function findUserByEmail(email: string): Promise<AdminUser | undefined> {
  const [user] = await getDb().select().from(adminUsers).where(eq(adminUsers.email, email.trim().toLowerCase()));
  return user;
}

// ---------------------------------------------------------------------------
// step 1: password
// ---------------------------------------------------------------------------

export type PasswordResult =
  | { ok: true; user: AdminUser; trustedDevice: boolean }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; until: Date };

/** wrong passwords allowed from a remembered device before it is forgotten */
export const MAX_DEVICE_FAILURES = 5;

/** the remembered device for this email, if the cookie is valid for that account */
async function findTrustedDevice(token: string | undefined, email: string): Promise<{ id: string; user: AdminUser } | null> {
  if (!token) return null;
  const [row] = await getDb()
    .select({ id: trustedDevices.id, user: adminUsers })
    .from(trustedDevices)
    .innerJoin(adminUsers, eq(adminUsers.id, trustedDevices.userId))
    .where(
      and(
        eq(trustedDevices.id, sha256(token)),
        eq(adminUsers.email, email.trim().toLowerCase()),
        gt(trustedDevices.expiresAt, new Date()),
      ),
    );
  return row ?? null;
}

/**
 * Password step on a remembered device: the account and IP locks don't apply (someone else may
 * have caused them), only the device's own counter. 5 wrong -> the device is forgotten.
 */
async function attemptPasswordOnDevice(device: { id: string; user: AdminUser }, email: string, password: string, ip: string): Promise<PasswordResult> {
  const deviceKey = `pw-dev:${device.id}`;
  const user = await verifyLogin(email, password);
  if (user) {
    await clear(deviceKey);
    await getDb().update(trustedDevices).set({ lastUsedAt: new Date() }).where(eq(trustedDevices.id, device.id));
    return { ok: true, user, trustedDevice: true };
  }
  if ((await hit(deviceKey, RULES.password.windowMs)) >= MAX_DEVICE_FAILURES) {
    await getDb().delete(trustedDevices).where(eq(trustedDevices.id, device.id));
    await clear(deviceKey);
    void sendDeviceForgottenAlert(device.user, ip);
  }
  return { ok: false, reason: "invalid" };
}

async function sendDeviceForgottenAlert(user: AdminUser, ip: string): Promise<void> {
  const text = `Op een onthouden apparaat is ${MAX_DEVICE_FAILURES} keer een verkeerd wachtwoord ingevuld voor ${user.email}.\n\nDat apparaat wordt daarom niet meer onthouden: bij de volgende login is weer een code per mail nodig.\nIP-adres: ${shownIp(ip)}\n\nWas jij dit niet? Dan heeft iemand toegang tot een browser waarop je ingelogd was. Verander je wachtwoord met create-admin; dat logt je overal uit.`;
  await sendMail({
    to: user.email,
    subject: "Let op: onthouden apparaat vergeten na foute wachtwoorden",
    text,
    html: mailLayout("Onthouden apparaat vergeten", text.split("\n").map((l) => `<p>${escapeHtml(l)}</p>`).join("")),
  }).catch((err) => console.error("[auth] device alert mail failed:", err));
}

export async function attemptPassword(email: string, password: string, ip: string, deviceToken?: string): Promise<PasswordResult> {
  const device = await findTrustedDevice(deviceToken, email);
  if (device) return attemptPasswordOnDevice(device, email, password, ip);

  const emailKey = `pw:${email.trim().toLowerCase()}`;
  // per-IP limit only for a real visitor IP, never for a proxy/internal address shared by everyone
  const ipKey = isPublicIp(ip) ? `pw-ip:${ip}` : null;

  const locked = later(await lockedUntil(emailKey), ipKey ? await lockedUntil(ipKey) : null);
  if (locked) return { ok: false, reason: "locked", until: locked };

  const user = await verifyLogin(email, password);
  if (user) {
    await getDb()
      .update(authThrottle)
      .set({ failures: 0, windowStart: new Date() })
      .where(eq(authThrottle.key, emailKey));
    return { ok: true, user, trustedDevice: false };
  }

  let until: Date | null = null;
  if ((await hit(emailKey, RULES.password.windowMs)) >= RULES.password.max) {
    until = await lock(emailKey, RULES.password);
    const target = await findUserByEmail(email);
    if (target) void sendLockAlert(target, `Er is ${RULES.password.max} keer een verkeerd wachtwoord ingevuld voor ${target.email}.`, until, ip);
  }
  if (ipKey && (await hit(ipKey, RULES.passwordIp.windowMs)) >= RULES.passwordIp.max) {
    const ipUntil = await lock(ipKey, RULES.passwordIp);
    until = later(until, ipUntil);
    void sendIpLockAlert(ip, email, ipUntil);
  }
  return until ? { ok: false, reason: "locked", until } : { ok: false, reason: "invalid" };
}

// ---------------------------------------------------------------------------
// step 2: code by mail
// ---------------------------------------------------------------------------

function newCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function codeHash(challengeId: number, code: string): string {
  return sha256(`${challengeId}:${code}`);
}

export type StartResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; reason: "locked"; until: Date }
  | { ok: false; reason: "mail_limit" | "mail_failed" };

/** after a correct password: creates the challenge and mails the code */
export async function startChallenge(user: AdminUser, ip: string): Promise<StartResult> {
  const locked = await lockedUntil(`code:${user.id}`);
  if (locked) return { ok: false, reason: "locked", until: locked };
  if ((await hit(`mail:${user.id}`, RULES.mail.windowMs)) > RULES.mail.max) return { ok: false, reason: "mail_limit" };

  const db = getDb();
  // only one pending login per account
  await db.delete(loginChallenges).where(eq(loginChallenges.userId, user.id));

  const token = randomBytes(32).toString("base64url");
  const code = newCode();
  const now = Date.now();
  const expiresAt = new Date(now + CHALLENGE_TTL_MS);
  const [row] = await db
    .insert(loginChallenges)
    .values({ tokenHash: sha256(token), userId: user.id, codeExpiresAt: new Date(now + CODE_TTL_MS), expiresAt, ip })
    .returning({ id: loginChallenges.id });
  await db.update(loginChallenges).set({ codeHash: codeHash(row.id, code) }).where(eq(loginChallenges.id, row.id));

  try {
    await sendCodeMail(user, code);
  } catch (err) {
    console.error("[auth] sending login code failed:", err);
    await db.delete(loginChallenges).where(eq(loginChallenges.id, row.id));
    return { ok: false, reason: "mail_failed" };
  }
  return { ok: true, token, expiresAt };
}

async function findChallenge(token: string | undefined) {
  if (!token) return undefined;
  const [row] = await getDb()
    .select({ challenge: loginChallenges, user: adminUsers })
    .from(loginChallenges)
    .innerJoin(adminUsers, eq(adminUsers.id, loginChallenges.userId))
    .where(and(eq(loginChallenges.tokenHash, sha256(token)), gt(loginChallenges.expiresAt, new Date())));
  return row;
}

export interface ChallengeInfo {
  email: string;
  /** seconds until "send again" is allowed */
  resendInSeconds: number;
  /** false when the current code expired or was used up by wrong attempts */
  codeActive: boolean;
}

/** for the code page: is there a pending login, and for which (masked) address */
export async function getChallengeInfo(token: string | undefined): Promise<ChallengeInfo | null> {
  const row = await findChallenge(token);
  if (!row) return null;
  const { challenge, user } = row;
  return {
    email: maskEmail(user.email),
    resendInSeconds: Math.max(0, Math.ceil((challenge.lastSentAt.getTime() + RESEND_COOLDOWN_MS - Date.now()) / 1000)),
    codeActive: Boolean(challenge.codeHash) && challenge.codeExpiresAt > new Date(),
  };
}

export type VerifyResult =
  | { ok: true; user: AdminUser }
  | { ok: false; reason: "no_challenge" }
  | { ok: false; reason: "locked"; until: Date }
  | { ok: false; reason: "code_inactive" }
  | { ok: false; reason: "wrong"; attemptsLeft: number };

export async function verifyChallengeCode(token: string | undefined, input: string, ip: string): Promise<VerifyResult> {
  const row = await findChallenge(token);
  if (!row) return { ok: false, reason: "no_challenge" };
  const { challenge, user } = row;
  const codeKey = `code:${user.id}`;
  const db = getDb();

  const locked = await lockedUntil(codeKey);
  if (locked) return { ok: false, reason: "locked", until: locked };
  if (!challenge.codeHash || challenge.codeExpiresAt <= new Date()) return { ok: false, reason: "code_inactive" };

  const code = input.replace(/\D/g, "");
  const given = Buffer.from(codeHash(challenge.id, code));
  const expected = Buffer.from(challenge.codeHash);
  if (code.length === 6 && given.length === expected.length && timingSafeEqual(given, expected)) {
    const [consumed] = await db
      .delete(loginChallenges)
      .where(
        and(
          eq(loginChallenges.id, challenge.id),
          eq(loginChallenges.codeHash, challenge.codeHash),
          gt(loginChallenges.codeExpiresAt, new Date()),
          gt(loginChallenges.expiresAt, new Date()),
        ),
      )
      .returning({ id: loginChallenges.id });
    if (!consumed) return { ok: false, reason: "code_inactive" };
    await clear(codeKey);
    return { ok: true, user };
  }

  // wrong: count on the code (void after 3) and on the account (lock after 10 per hour)
  const [updated] = await db
    .update(loginChallenges)
    .set({
      attempts: sql`${loginChallenges.attempts} + 1`,
      codeHash: sql`CASE WHEN ${loginChallenges.attempts} + 1 >= ${MAX_CODE_ATTEMPTS} THEN NULL ELSE ${loginChallenges.codeHash} END`,
    })
    .where(eq(loginChallenges.id, challenge.id))
    .returning({ attempts: loginChallenges.attempts });

  if ((await hit(codeKey, RULES.code.windowMs)) >= RULES.code.max) {
    const until = await lock(codeKey, RULES.code);
    await db.delete(loginChallenges).where(eq(loginChallenges.userId, user.id));
    void sendLockAlert(user, `Er is ${RULES.code.max} keer een verkeerde inlogcode ingevuld.`, until, ip);
    return { ok: false, reason: "locked", until };
  }
  return { ok: false, reason: "wrong", attemptsLeft: Math.max(0, MAX_CODE_ATTEMPTS - (updated?.attempts ?? MAX_CODE_ATTEMPTS)) };
}

export type ResendResult =
  | { ok: true }
  | { ok: false; reason: "no_challenge" | "mail_limit" | "mail_failed" }
  | { ok: false; reason: "cooldown"; seconds: number }
  | { ok: false; reason: "locked"; until: Date };

export async function resendCode(token: string | undefined): Promise<ResendResult> {
  const row = await findChallenge(token);
  if (!row) return { ok: false, reason: "no_challenge" };
  const { challenge, user } = row;

  const locked = await lockedUntil(`code:${user.id}`);
  if (locked) return { ok: false, reason: "locked", until: locked };
  const wait = challenge.lastSentAt.getTime() + RESEND_COOLDOWN_MS - Date.now();
  if (wait > 0) return { ok: false, reason: "cooldown", seconds: Math.ceil(wait / 1000) };
  if ((await hit(`mail:${user.id}`, RULES.mail.windowMs)) > RULES.mail.max) return { ok: false, reason: "mail_limit" };

  const code = newCode();
  await getDb()
    .update(loginChallenges)
    .set({ codeHash: codeHash(challenge.id, code), attempts: 0, codeExpiresAt: new Date(Date.now() + CODE_TTL_MS), lastSentAt: new Date() })
    .where(eq(loginChallenges.id, challenge.id));
  try {
    await sendCodeMail(user, code);
  } catch (err) {
    console.error("[auth] resending login code failed:", err);
    return { ok: false, reason: "mail_failed" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// trusted devices
// ---------------------------------------------------------------------------

export async function createTrustedDevice(userId: number, userAgent: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TRUSTED_DAYS * 24 * 60 * MIN);
  await getDb()
    .insert(trustedDevices)
    .values({ id: sha256(token), userId, userAgent: userAgent.slice(0, 300), expiresAt });
  return { token, expiresAt };
}

// ---------------------------------------------------------------------------

export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  return `${name.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(6, name.length - 1)))}@${domain}`;
}

/** "over 14 minuten" / "om 15:42" */
export function untilText(until: Date): string {
  const minutes = Math.ceil((until.getTime() - Date.now()) / MIN);
  return minutes <= 60 ? `over ${minutes} ${minutes === 1 ? "minuut" : "minuten"}` : `om ${timeNl(until)}`;
}
