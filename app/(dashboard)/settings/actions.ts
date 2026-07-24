"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { setAuthorityKeywords } from "@/lib/authority";
import { runSyncJob } from "@/lib/sync";

// Best-effort — a campaign save should never fail just because the
// immediately-following sync hit a problem (bad list ID, HubSpot hiccup,
// etc.); the dashboard's error banner already surfaces that separately.
async function syncCampaignSafely(campaignId: number) {
  try {
    await runSyncJob({ campaignIds: [campaignId] });
  } catch (err) {
    console.error(`[settings] post-save sync failed for campaign ${campaignId}:`, err);
  }
}

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export async function createCampaign(formData: FormData) {
  const name = str(formData, "name");
  const hubspotListId = str(formData, "hubspotListId");
  if (!name || !hubspotListId) return;

  const [created] = await db
    .insert(campaigns)
    .values({
      name,
      hubspotListId,
      sequenceLabel: str(formData, "sequenceLabel"),
      ownerName: str(formData, "ownerName"),
      ownerEmail: str(formData, "ownerEmail"),
      targetCount: str(formData, "targetCount") ? Number(str(formData, "targetCount")) : null,
      startDate: str(formData, "startDate"),
      endDate: str(formData, "endDate"),
    })
    .returning();

  await syncCampaignSafely(created.id);

  revalidatePath("/settings");
  revalidatePath("/campaigns");
  revalidatePath("/");
}

export async function updateCampaignStatus(formData: FormData) {
  const id = Number(formData.get("id"));
  const status = str(formData, "status");
  if (!id || !status) return;

  await db.update(campaigns).set({ status }).where(eq(campaigns.id, id));

  revalidatePath("/settings");
  revalidatePath("/campaigns");
  revalidatePath("/");
}

export async function updateCampaign(formData: FormData) {
  const id = Number(formData.get("id"));
  const name = str(formData, "name");
  const hubspotListId = str(formData, "hubspotListId");
  if (!id || !name || !hubspotListId) return;

  await db
    .update(campaigns)
    .set({
      name,
      hubspotListId,
      sequenceLabel: str(formData, "sequenceLabel"),
      ownerName: str(formData, "ownerName"),
      ownerEmail: str(formData, "ownerEmail"),
      targetCount: str(formData, "targetCount") ? Number(str(formData, "targetCount")) : null,
      startDate: str(formData, "startDate"),
      endDate: str(formData, "endDate"),
      status: str(formData, "status") ?? "active",
    })
    .where(eq(campaigns.id, id));

  await syncCampaignSafely(id);

  revalidatePath("/settings");
  revalidatePath("/campaigns");
  revalidatePath("/");
}

export async function deleteCampaign(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!id) return;

  await db.delete(campaigns).where(eq(campaigns.id, id));

  revalidatePath("/settings");
  revalidatePath("/campaigns");
  revalidatePath("/");
}

export async function saveAuthorityKeywords(formData: FormData) {
  const raw = str(formData, "keywords") ?? "";
  const keywords = raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  await setAuthorityKeywords(keywords);
  revalidatePath("/settings");
}
