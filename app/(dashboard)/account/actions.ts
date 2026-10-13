"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/passwords";

export async function changePassword(_prev: { message?: string; error?: string } | undefined, formData: FormData) {
  // owner only: everyone else's password is set by the owner in Settings
  const user = await requireAdmin();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  if (next.length < 8) return { error: "New password must be at least 8 characters" };
  if (!(await verifyPassword(current, user.passwordHash))) return { error: "Current password is wrong" };
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next), sessionsValidAfter: new Date(Date.now() - 1000) })
    .where(eq(users.id, user.id));
  return { message: "Password changed" };
}
