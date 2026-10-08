"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bdrCampaigns, segments } from "@/lib/db/schema";
import { requireAdmin, requireUser, type CurrentUser } from "@/lib/session";
import { getListName } from "@/lib/hubspot";
import { runSegmentSync } from "@/lib/segment-sync";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function revalidate() {
  revalidatePath("/segments");
  revalidatePath("/team");
}

// BDR logins always register segments as themselves; admins pick the rep.
function resolveOwner(user: CurrentUser, formData: FormData): string | null {
  return user.role === "admin" ? str(formData, "ownerId") : user.hubspotOwnerId;
}

async function resolveCampaignId(formData: FormData): Promise<number | null> {
  const newName = str(formData, "newCampaign");
  if (newName) {
    const [c] = await db
      .insert(bdrCampaigns)
      .values({ name: newName })
      .onConflictDoUpdate({ target: bdrCampaigns.name, set: { archived: false } })
      .returning();
    return c.id;
  }
  const id = Number(formData.get("campaignId"));
  return id || null;
}

async function canEdit(user: CurrentUser, segmentId: number) {
  if (user.role === "admin") return true;
  const [s] = await db.select().from(segments).where(eq(segments.id, segmentId));
  return Boolean(s && s.ownerId === user.hubspotOwnerId);
}

export async function registerSegment(formData: FormData) {
  const user = await requireUser();
  const listId = str(formData, "listId");
  const ownerId = resolveOwner(user, formData);
  const startDate = str(formData, "startDate");
  const campaignId = await resolveCampaignId(formData);
  if (!listId || !ownerId || !startDate || !campaignId) return;

  const listName = await getListName(listId);
  const [created] = await db
    .insert(segments)
    .values({
      campaignId,
      hubspotListId: listId,
      listName,
      ownerId,
      startDate,
      endDate: str(formData, "endDate"),
      createdByUserId: user.id,
    })
    .returning();

  // Best-effort: fill its numbers now so the rep sees them immediately.
  try {
    await runSegmentSync({ segmentIds: [created.id] });
  } catch (err) {
    console.error("[segments] post-register sync failed:", err);
  }
  revalidate();
}

export async function updateSegment(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  const startDate = str(formData, "startDate");
  const campaignId = await resolveCampaignId(formData);
  if (!id || !startDate || !campaignId || !(await canEdit(user, id))) return;

  await db
    .update(segments)
    .set({
      campaignId,
      startDate,
      endDate: str(formData, "endDate"),
      ...(user.role === "admin" && str(formData, "ownerId") ? { ownerId: str(formData, "ownerId")! } : {}),
    })
    .where(eq(segments.id, id));
  try {
    await runSegmentSync({ segmentIds: [id] });
  } catch (err) {
    console.error("[segments] post-edit sync failed:", err);
  }
  revalidate();
}

export async function deleteSegment(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  if (!id || !(await canEdit(user, id))) return;
  await db.delete(segments).where(eq(segments.id, id));
  await db.execute(sql`update team_deals set segment_id = null where segment_id = ${id}`);
  revalidate();
}

export async function setCampaignArchived(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!id) return;
  await db.update(bdrCampaigns).set({ archived: formData.get("archived") === "true" }).where(eq(bdrCampaigns.id, id));
  revalidate();
}
