import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export type CurrentUser = typeof users.$inferSelect;

// The app owner (per the user) is the ONLY login that can change anything:
// settings, logins / passwords, goals, segments, syncs, enrichment. Every
// other login, even one given the admin role, is read-only (plus live chat).
export const OWNER_USERNAME = (process.env.OWNER_USERNAME || "anish").toLowerCase();
export function isOwner(user: { username: string; role: string } | null | undefined) {
  return user?.role === "admin" && user.username === OWNER_USERNAME;
}

// The signed cookie says who you are; the DB says whether you still exist and
// are active. Every page/action that needs the user goes through here.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const claims = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const [user] = await db.select().from(users).where(eq(users.id, claims.userId));
  if (!user || !user.active) return null;
  // signed in before a password change / deactivation / role change: dead session
  if (user.sessionsValidAfter && (claims.issuedAt ?? 0) < user.sessionsValidAfter.getTime()) return null;
  if (claims.role !== user.role) return null;
  return user;
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// Every write outside live chat goes through here: owner only.
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isOwner(user)) redirect("/team");
  return user;
}
