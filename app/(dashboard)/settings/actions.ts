"use server";

import { requireAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { appSettings, liveEvents, owners, teamMembers, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/passwords";
import { eq } from "drizzle-orm";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

// --- Team members -------------------------------------------------------------
// Team data itself is synced for every HubSpot owner (see lib/team-sync.ts),
// so adding someone here shows their full history immediately — no resync.

function revalidateTeam() {
  revalidatePath("/settings");
  revalidatePath("/team");
}

export async function addTeamMember(formData: FormData) {
  await requireAdmin();
  const ownerId = str(formData, "ownerId");
  if (!ownerId) return;
  const [owner] = await db.select().from(owners).where(eq(owners.hubspotOwnerId, ownerId));
  await db
    .insert(teamMembers)
    .values({
      hubspotOwnerId: ownerId,
      name: str(formData, "name") ?? owner?.name ?? ownerId,
      role: str(formData, "role") ?? "bdr",
      teamGroup: str(formData, "teamGroup") ?? "Core BDRs",
      startDate: str(formData, "startDate"),
      endDate: str(formData, "endDate"),
    })
    .onConflictDoNothing();
  revalidateTeam();
}

export async function updateTeamMember(formData: FormData) {
  await requireAdmin();
  const ownerId = str(formData, "ownerId");
  const name = str(formData, "name");
  if (!ownerId || !name) return;
  await db
    .update(teamMembers)
    .set({
      name,
      role: str(formData, "role") ?? "bdr",
      teamGroup: str(formData, "teamGroup") ?? "Core BDRs",
      startDate: str(formData, "startDate"),
      endDate: str(formData, "endDate"),
    })
    .where(eq(teamMembers.hubspotOwnerId, ownerId));
  revalidateTeam();
}

export async function removeTeamMember(formData: FormData) {
  await requireAdmin();
  const ownerId = str(formData, "ownerId");
  if (!ownerId) return;
  await db.delete(teamMembers).where(eq(teamMembers.hubspotOwnerId, ownerId));
  revalidateTeam();
}

// --- Users ----------------------------------------------------------------------

function emailOf(formData: FormData): string | null {
  const e = str(formData, "email")?.toLowerCase() ?? null;
  return e && /.+@.+\..+/.test(e) ? e : null;
}

export async function createUser(formData: FormData) {
  await requireAdmin();
  const username = str(formData, "username")?.toLowerCase();
  const name = str(formData, "name");
  const password = str(formData, "password");
  if (!username || !name || !password) return;
  await db
    .insert(users)
    .values({
      username,
      name,
      passwordHash: await hashPassword(password),
      role: str(formData, "role") === "admin" ? "admin" : "bdr",
      hubspotOwnerId: str(formData, "hubspotOwnerId"),
      email: emailOf(formData),
    })
    .onConflictDoNothing();
  revalidatePath("/settings");
}

export async function updateUser(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  if (!id) return;
  const password = str(formData, "password");
  await db
    .update(users)
    .set({
      name: str(formData, "name") ?? undefined,
      role: str(formData, "role") === "admin" ? "admin" : "bdr",
      hubspotOwnerId: str(formData, "hubspotOwnerId"),
      email: emailOf(formData),
      // an admin can't lock themselves out
      active: id === admin.id ? true : formData.get("active") === "on",
      ...(password ? { passwordHash: await hashPassword(password) } : {}),
    })
    .where(eq(users.id, id));
  revalidatePath("/settings");
}

// --- Live notifications ------------------------------------------------------------

async function putSetting(key: string, value: unknown) {
  await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

export async function saveNotificationSettings(formData: FormData) {
  await requireAdmin();
  const teams = str(formData, "teamsWebhookUrl");
  if (teams && !/^https:\/\//.test(teams)) throw new Error("Teams webhook URL must start with https://");
  await putSetting("teams_webhook_url", teams ?? null);
  await putSetting("email_from", str(formData, "emailFrom") ?? null);
  await putSetting("email_wins", formData.get("emailWins") === "on");
  await putSetting("outcome_reminders", formData.get("outcomeReminders") === "on");
  revalidatePath("/settings");
}

export async function saveCommission(formData: FormData) {
  await requireAdmin();
  const num = (k: string, fallback: number) => {
    const n = Number(str(formData, k));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  await putSetting("commission", {
    visible: formData.get("visible") === "on",
    base: num("base", 25),
    threshold: Math.round(num("threshold", 10)),
    high: num("high", 50),
  });
  revalidatePath("/settings");
  revalidatePath("/team");
}

// Posts a test win to Teams + email so the setup can be checked end to end.
export async function sendTestNotification() {
  const me = await requireAdmin();
  const { notifyPending } = await import("@/lib/live");
  await db.insert(liveEvents).values({
    kind: "meeting",
    title: "Test: notifications are working",
    body: `Sent from Settings by ${me.name}`,
  });
  await notifyPending();
  revalidatePath("/settings");
}
