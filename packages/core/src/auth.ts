import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { getDb } from "./db.ts";
import { adminUsers, authThrottle, loginChallenges, sessions, trustedDevices, type AdminUser } from "./schema.ts";

export const SESSION_COOKIE = "fgb_session";
export const SESSION_DAYS = 30;

export function hashPassword(password: string): Promise<string> {
  return hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export function sha256(token: string): string {
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
  // opportunistic cleanup of expired sessions, devices, login codes and old counters
  await cleanupExpiredAuth();
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

/** logs a user out everywhere: all sessions, trusted devices and pending login codes (e.g. after a password reset) */
export async function revokeAllAccess(userId: number): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await db.delete(trustedDevices).where(eq(trustedDevices.userId, userId));
  await db.delete(loginChallenges).where(eq(loginChallenges.userId, userId));
}

/** removes expired sessions, devices and login codes */
export async function cleanupExpiredAuth(): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  await db.delete(trustedDevices).where(lt(trustedDevices.expiresAt, now));
  await db.delete(loginChallenges).where(lt(loginChallenges.expiresAt, now));
  // counters with no activity for a day and no running lock (keeps the 24 h lock escalation)
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  await db
    .delete(authThrottle)
    .where(
      and(
        lt(authThrottle.windowStart, dayAgo),
        or(isNull(authThrottle.lockedUntil), lt(authThrottle.lockedUntil, now)),
        or(isNull(authThrottle.lastLockAt), lt(authThrottle.lastLockAt, dayAgo)),
      ),
    );
}
