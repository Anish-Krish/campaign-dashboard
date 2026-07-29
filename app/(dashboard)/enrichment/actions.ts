"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, companies, contacts, enrichmentRows, enrichmentRuns } from "@/lib/db/schema";
import { batchReadObjects } from "@/lib/hubspot";
import { inngest } from "@/lib/inngest/client";
import { getEnrichmentRun, getEnrichmentRows } from "@/lib/queries";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// The one entry point for kicking off a run — mirrors how lib/sync.ts's
// runSyncJob() is the single place that inserts a job-bookkeeping row before
// doing the real work. Builds enrichment_rows from contacts/companies
// (contacts/companies don't cache HubSpot's "domain" company property, so
// it's fetched live here — LeadMagic/Prospeo match far better against a
// domain than a bare company name), then fires the Inngest event that
// lib/inngest/functions/enrichmentWaterfall.ts picks up.
export async function triggerEnrichmentRun(formData: FormData) {
  const campaignId = Number(formData.get("campaignId"));
  const authorityOnly = formData.get("authorityOnly") === "on";
  if (!campaignId) return;

  const contactRows = await db
    .select({
      hubspotContactId: contacts.hubspotContactId,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      companyId: contacts.companyId,
      companyName: companies.name,
    })
    .from(contacts)
    .leftJoin(companies, eq(contacts.companyId, companies.hubspotCompanyId))
    .where(
      authorityOnly
        ? and(eq(contacts.campaignId, campaignId), eq(contacts.isAuthority, true))
        : eq(contacts.campaignId, campaignId),
    );

  if (contactRows.length === 0) {
    redirect("/enrichment");
  }

  const uniqueCompanyIds = Array.from(
    new Set(contactRows.map((c) => c.companyId).filter((v): v is string => Boolean(v))),
  );
  const domainByCompanyId = new Map<string, string>();
  if (uniqueCompanyIds.length > 0) {
    const companyRecords = await batchReadObjects<{ domain?: string }>("companies", uniqueCompanyIds, ["domain"]);
    for (const r of companyRecords) {
      if (r.properties.domain) domainByCompanyId.set(r.id, r.properties.domain);
    }
  }

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));

  const [run] = await db
    .insert(enrichmentRuns)
    .values({
      campaignId,
      label: `${campaign?.name ?? "Campaign"} — ${authorityOnly ? "authority contacts" : "all contacts"}`,
      status: "queued",
      triggerSource: "manual_ui",
      totalRows: contactRows.length,
    })
    .returning();

  for (const batch of chunk(contactRows, 200)) {
    await db.insert(enrichmentRows).values(
      batch.map((c) => ({
        runId: run.id,
        contactId: c.hubspotContactId,
        firstName: c.firstName,
        lastName: c.lastName,
        companyName: c.companyName,
        domain: c.companyId ? (domainByCompanyId.get(c.companyId) ?? null) : null,
      })),
    );
  }

  await inngest.send({ name: "enrichment/run.requested", data: { runId: run.id } });

  revalidatePath("/enrichment");
  redirect(`/enrichment?run=${run.id}`);
}

// Polled from the client every few seconds while a run is queued/running —
// see components/EnrichmentExplorer.tsx.
export async function getEnrichmentRunSnapshot(runId: number) {
  const [run, rows] = await Promise.all([getEnrichmentRun(runId), getEnrichmentRows(runId)]);
  return { run, rows };
}
