"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { setAuthorityKeywords } from "@/lib/authority";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export async function createCampaign(formData: FormData) {
  const name = str(formData, "name");
  const hubspotListId = str(formData, "hubspotListId");
  if (!name || !hubspotListId) return;

  await db.insert(campaigns).values({
    name,
    hubspotListId,
    sequenceLabel: str(formData, "sequenceLabel"),
    ownerName: str(formData, "ownerName"),
    ownerEmail: str(formData, "ownerEmail"),
    targetCount: str(formData, "targetCount") ? Number(str(formData, "targetCount")) : null,
    startDate: str(formData, "startDate"),
    endDate: str(formData, "endDate"),
  });

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
