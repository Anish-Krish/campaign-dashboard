"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, count, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { loginFailures, users } from "@/lib/db/schema";
import { SESSION_COOKIE, createSessionToken, type SessionRole } from "@/lib/auth";
import { verifyPassword } from "@/lib/passwords";

export async function login(_prevState: { error?: string } | undefined, formData: FormData) {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = formData.get("password");
  if (!username || typeof password !== "string") return { error: "Enter your username and password" };

  // Lockout: 5 wrong passwords for a username, or 20 from one address, in
  // 15 minutes blocks further tries until the window passes.
  const ip = ((await headers()).get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const [{ byUser }] = await db
    .select({ byUser: count() })
    .from(loginFailures)
    .where(and(eq(loginFailures.username, username), gte(loginFailures.at, since)));
  const [{ byIp }] = ip
    ? await db.select({ byIp: count() }).from(loginFailures).where(and(eq(loginFailures.ip, ip), gte(loginFailures.at, since)))
    : [{ byIp: 0 }];
  if (byUser >= 5 || byIp >= 20) return { error: "Too many attempts. Try again in 15 minutes." };

  const [user] = await db.select().from(users).where(eq(users.username, username));
  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
    await db.insert(loginFailures).values({ username, ip });
    return { error: "Incorrect username or password" };
  }
  // a successful sign-in clears that username's failures
  await db.delete(loginFailures).where(eq(loginFailures.username, username));

  const token = await createSessionToken({ userId: user.id, role: user.role as SessionRole });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  redirect("/team");
}
