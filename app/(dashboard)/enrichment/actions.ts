"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { parse } from "csv-parse/sync";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, companies, contacts, enrichmentRows, enrichmentRuns } from "@/lib/db/schema";
import {
  batchReadObjects,
  batchUpdateObjects,
  getContactCurrentFields,
  getContactPhoneFields,
  pickCurrentMobile,
} from "@/lib/hubspot";
import { inngest } from "@/lib/inngest/client";
import { getEnrichmentRun, getEnrichmentRows } from "@/lib/queries";
import { EMAIL_STAGES, MOBILE_STAGES, type Stage } from "@/lib/enrichment/stages";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type NewEnrichmentRow = {
  contactId: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  domain: string | null;
  // Snapshot of the contact's current HubSpot fields (campaign-sourced rows
  // only — CSV rows have no contactId to read). When present, emailStatus/
  // mobileStatus are pre-set to "found"/"existing" so these rows are never
  // picked up by pendingRows() — no LeadMagic/Prospeo/ZeroBounce call is
  // ever made for data we already have, no matter which stage button gets
  // clicked, without needing every stage to carry its own existing-data check.
  currentEmail?: string | null;
  currentPhone?: string | null;
  currentWorkPhone?: string | null;
  currentMobilePhone?: string | null;
  currentDirectPhone?: string | null;
  emailStatus?: "found";
  email?: string | null;
  emailSource?: "existing";
  mobileStatus?: "found";
  mobile?: string | null;
  mobileSource?: "existing";
};

// Shared tail for both entry points below (campaign-sourced and
// CSV-sourced): just insert the rows. Deliberately does NOT fire the
// enrichment event — selecting a campaign or uploading a CSV should show the
// full spreadsheet (source columns populated, enrichment columns empty)
// immediately, Clay-style, with zero provider calls made until the user
// clicks a stage button. Runs are created in "draft" status; the run only
// moves to "queued" (and stages actually start) via triggerEnrichmentStage
// below.
async function insertRows(runId: number, rows: NewEnrichmentRow[]) {
  for (const batch of chunk(rows, 200)) {
    await db.insert(enrichmentRows).values(batch.map((r) => ({ runId, ...r })));
  }
}

// Builds enrichment_rows from an existing campaign's contacts/companies
// (contacts/companies don't cache HubSpot's "domain" company property, so
// it's fetched live here — LeadMagic/Prospeo match far better against a
// domain than a bare company name).
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

  // Snapshot each contact's current email/phone fields so the spreadsheet
  // can show what's already on file — and so rows that already have data
  // are inserted pre-marked "found"/"existing", which keeps them out of
  // pendingRows() entirely (see NewEnrichmentRow above).
  const currentFieldsByContactId = new Map(
    (await getContactCurrentFields(contactRows.map((c) => c.hubspotContactId))).map((r) => [r.id, r]),
  );

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));

  const [run] = await db
    .insert(enrichmentRuns)
    .values({
      campaignId,
      label: `${campaign?.name ?? "Campaign"} — ${authorityOnly ? "authority contacts" : "all contacts"}`,
      status: "draft",
      triggerSource: "manual_ui",
      totalRows: contactRows.length,
    })
    .returning();

  await insertRows(
    run.id,
    contactRows.map((c) => {
      const current = currentFieldsByContactId.get(c.hubspotContactId);
      const currentMobile = current ? pickCurrentMobile(current) : null;
      return {
        contactId: c.hubspotContactId,
        firstName: c.firstName,
        lastName: c.lastName,
        companyName: c.companyName,
        domain: c.companyId ? (domainByCompanyId.get(c.companyId) ?? null) : null,
        currentEmail: current?.email ?? null,
        currentPhone: current?.phone ?? null,
        currentWorkPhone: current?.work_phone ?? null,
        currentMobilePhone: current?.mobilephone ?? null,
        currentDirectPhone: current?.direct_phone ?? null,
        ...(current?.email ? { emailStatus: "found" as const, email: current.email, emailSource: "existing" as const } : {}),
        ...(currentMobile ? { mobileStatus: "found" as const, mobile: currentMobile, mobileSource: "existing" as const } : {}),
      };
    }),
  );

  revalidatePath("/enrichment");
  redirect(`/enrichment?run=${run.id}`);
}

const COLUMN_ALIASES = {
  firstName: ["first name", "firstname", "first"],
  lastName: ["last name", "lastname", "last"],
  companyName: ["company", "company name", "organization", "company name (from crm)"],
  domain: ["domain", "website", "company domain", "company website", "company domain name"],
};

// Reads an uploaded CSV server-side and auto-detects which column maps to
// which field by common header aliases — nothing is written to the DB yet.
// The client shows the detected mapping (editable) and a row-count preview
// before calling triggerEnrichmentRunFromRows to actually create the run.
export async function parseEnrichmentCsv(formData: FormData): Promise<{
  headers: string[];
  rows: Record<string, string>[];
  detectedMapping: Record<keyof typeof COLUMN_ALIASES, string | null>;
}> {
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file uploaded");

  const text = await file.text();
  const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

  const detect = (aliases: string[]) => headers.find((h) => aliases.includes(h.toLowerCase().trim())) ?? null;
  const detectedMapping = {
    firstName: detect(COLUMN_ALIASES.firstName),
    lastName: detect(COLUMN_ALIASES.lastName),
    companyName: detect(COLUMN_ALIASES.companyName),
    domain: detect(COLUMN_ALIASES.domain),
  };

  return { headers, rows, detectedMapping };
}

// Ad hoc list, not tied to any campaign — enrichmentRuns.campaignId and
// enrichmentRows.contactId are already nullable soft-references for exactly
// this case. No HubSpot domain lookup here (there's no companyId to look
// one up from) — whatever the CSV's own domain column mapped to (or nothing)
// is used as-is.
export async function triggerEnrichmentRunFromRows(
  rows: Record<string, string>[],
  mapping: { firstName: string; lastName: string; companyName: string | null; domain: string | null },
  label: string,
) {
  if (rows.length === 0) return;

  const [run] = await db
    .insert(enrichmentRuns)
    .values({
      campaignId: null,
      label: label || "Uploaded list",
      status: "draft",
      triggerSource: "manual_ui",
      totalRows: rows.length,
    })
    .returning();

  await insertRows(
    run.id,
    rows.map((r) => ({
      contactId: null,
      firstName: r[mapping.firstName] || null,
      lastName: r[mapping.lastName] || null,
      companyName: mapping.companyName ? r[mapping.companyName] || null : null,
      domain: mapping.domain ? r[mapping.domain] || null : null,
    })),
  );

  revalidatePath("/enrichment");
  redirect(`/enrichment?run=${run.id}`);
}

// Fired by the per-stage trigger bar in EnrichmentExplorer — re-runs one or
// more specific waterfall stages against either the checked rows or (if
// nothing's checked) every row in the run still needing that field.
// Un-resolves rows first (no_match/error/rejected -> pending, scoped to
// exactly the field(s) the requested stages touch) so the Inngest function's
// own "only work pending rows" query picks them back up — rows that already
// have a clean `found` result are left untouched, never overwritten by a
// manual retry of an earlier stage.
export async function triggerEnrichmentStage(runId: number, stages?: Stage[], rowIds?: number[]) {
  const touchesEmail = !stages || stages.some((s) => EMAIL_STAGES.includes(s));
  const touchesMobile = !stages || stages.some((s) => MOBILE_STAGES.includes(s));
  const rowScope = rowIds && rowIds.length > 0 ? inArray(enrichmentRows.id, rowIds) : undefined;

  if (touchesEmail) {
    await db
      .update(enrichmentRows)
      .set({ emailStatus: "pending", updatedAt: new Date() })
      .where(and(eq(enrichmentRows.runId, runId), inArray(enrichmentRows.emailStatus, ["no_match", "error", "rejected"]), rowScope));
  }
  if (touchesMobile) {
    await db
      .update(enrichmentRows)
      .set({ mobileStatus: "pending", updatedAt: new Date() })
      .where(and(eq(enrichmentRows.runId, runId), inArray(enrichmentRows.mobileStatus, ["no_match", "error", "rejected"]), rowScope));
  }

  await db
    .update(enrichmentRuns)
    .set({ status: "queued", errorMessage: null, finishedAt: null })
    .where(eq(enrichmentRuns.id, runId));

  await inngest.send({ name: "enrichment/run.requested", data: { runId, stages, rowIds } });

  revalidatePath("/enrichment");
}

// Normalizes to bare digits, canonicalized to a 10-digit NANP number where
// applicable (an 11-digit number starting with "1" is the same number as
// its 10-digit form without the country code) — so "+1 416-555-1234",
// "14165551234", and "(416) 555-1234" all compare equal.
function normalizePhoneDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits || null;
}

// The app's first-ever write to HubSpot — this app has been strictly
// read-only until this point, so it's deliberately manual/batch-confirmed
// (never automatic on enrichment success): pushes a newly-found mobile
// number into HubSpot's direct_phone property, but only for rows where it's
// genuinely new — a live digit-normalized comparison against the contact's
// current phone/work_phone/mobilephone/direct_phone catches the exact
// "ZoomInfo returned a number we already had, just reformatted" case found
// earlier by hand. Scoped to selected rows if given, otherwise every
// eligible row in the run.
export async function pushDirectPhoneToHubspot(runId: number, rowIds?: number[]) {
  const eligible = await db
    .select()
    .from(enrichmentRows)
    .where(
      and(
        eq(enrichmentRows.runId, runId),
        eq(enrichmentRows.mobileStatus, "found"),
        eq(enrichmentRows.directPhonePushStatus, "not_pushed"),
        rowIds && rowIds.length > 0 ? inArray(enrichmentRows.id, rowIds) : undefined,
      ),
    );
  const withContact = eligible.filter((r) => r.contactId && r.mobile);
  if (withContact.length === 0) return;

  const phoneFields = await getContactPhoneFields(withContact.map((r) => r.contactId!));
  const phoneFieldsByContactId = new Map(phoneFields.map((p) => [p.id, p]));

  // Dedup check only (no writes yet) — decide which rows are genuinely new
  // vs. already-known-duplicates.
  const toWrite: typeof withContact = [];
  for (const row of withContact) {
    const existing = phoneFieldsByContactId.get(row.contactId!);
    const newDigits = normalizePhoneDigits(row.mobile);
    const existingDigits = [existing?.phone, existing?.work_phone, existing?.mobilephone, existing?.direct_phone]
      .map(normalizePhoneDigits)
      .filter(Boolean);

    if (newDigits && existingDigits.includes(newDigits)) {
      await db
        .update(enrichmentRows)
        .set({ directPhonePushStatus: "skipped_duplicate", directPhonePushedAt: new Date() })
        .where(eq(enrichmentRows.id, row.id));
    } else {
      toWrite.push(row);
    }
  }

  // Only mark a row 'pushed' once the HubSpot write has actually succeeded —
  // never optimistically, since a failed write must not be recorded as done.
  if (toWrite.length > 0) {
    try {
      await batchUpdateObjects(
        "contacts",
        toWrite.map((row) => ({ id: row.contactId!, properties: { direct_phone: row.mobile! } })),
      );
      for (const row of toWrite) {
        await db
          .update(enrichmentRows)
          .set({ directPhonePushStatus: "pushed", directPhonePushedAt: new Date() })
          .where(eq(enrichmentRows.id, row.id));
      }
    } catch (err) {
      console.error(`[enrichment] direct_phone batch push failed for run ${runId}:`, err);
      for (const row of toWrite) {
        await db.update(enrichmentRows).set({ directPhonePushStatus: "error" }).where(eq(enrichmentRows.id, row.id));
      }
    }
  }

  revalidatePath("/enrichment");
}

// Polled from the client every few seconds while a run is queued/running —
// see components/EnrichmentExplorer.tsx.
export async function getEnrichmentRunSnapshot(runId: number) {
  const [run, rows] = await Promise.all([getEnrichmentRun(runId), getEnrichmentRows(runId)]);
  return { run, rows };
}
