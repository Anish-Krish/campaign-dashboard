"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { SESSION_COOKIE, createSessionToken, type SessionRole } from "@/lib/auth";
import { verifyPassword } from "@/lib/passwords";

export async function login(_prevState: { error?: string } | undefined, formData: FormData) {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = formData.get("password");
  if (!username || typeof password !== "string") return { error: "Enter your username and password" };

  const [user] = await db.select().from(users).where(eq(users.username, username));
  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Incorrect username or password" };
  }

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
