import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { getDb } from "./db.ts";
import { adminUsers, sessions, type AdminUser } from "./schema.ts";

export const SESSION_COOKIE = "fgb_session";
export const SESSION_DAYS = 30;

export function hashPassword(password: string): Promise<string> {
  return hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

function sha256(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

let dummyHash: Promise<string> | undefined;

/** verify credentials. Always runs a hash compare to keep timing similar for unknown emails. */
export async function verifyLogin(email: string, password: string): Promise<AdminUser | null> {
  const [user] = await getDb()
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, email.trim().toLowerCase()))
    .limit(1);
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  const ok = await verify(user?.passwordHash ?? (await dummyHash), password).catch(() => false);
  return user && ok ? user : null;
}

/** creates a session and returns the raw token for the cookie */
export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const db = getDb();
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  // opportunistic cleanup of expired sessions
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return { token, expiresAt };
}

export async function validateSession(token: string | undefined): Promise<AdminUser | null> {
  if (!token) return null;
  const row = await getDb().query.sessions.findFirst({
    where: eq(sessions.id, sha256(token)),
    with: { user: true },
  });
  if (!row || row.expiresAt < new Date()) return null;
  return row.user;
}

export async function deleteSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await getDb().delete(sessions).where(eq(sessions.id, sha256(token)));
}

// ---------------------------------------------------------------------------
// simple in-memory login rate limiter (single admin container)
// ---------------------------------------------------------------------------
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function isRateLimited(key: string): boolean {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

export function registerFailedAttempt(key: string): void {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: Date.now() });
  } else {
    entry.count++;
  }
}

export function clearAttempts(key: string): void {
  attempts.delete(key);
}
