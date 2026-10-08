import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export type CurrentUser = typeof users.$inferSelect;

// The signed cookie says who you are; the DB says whether you still exist and
// are active. Every page/action that needs the user goes through here.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const claims = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const [user] = await db.select().from(users).where(eq(users.id, claims.userId));
  return user && user.active ? user : null;
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/team");
  return user;
}
