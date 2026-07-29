import { and, eq, inArray, isNull } from "drizzle-orm";
import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { enrichmentFieldEvents, enrichmentRows, enrichmentRuns } from "@/lib/db/schema";
import { batchReadObjects } from "@/lib/hubspot";
import * as leadmagic from "@/lib/enrichment/leadmagic";
import * as prospeo from "@/lib/enrichment/prospeo";
import { validateEmailOrSkip, isAcceptableStatus } from "@/lib/enrichment/zerobounce";

type EnrichmentRow = typeof enrichmentRows.$inferSelect;

async function logEvent(
  rowId: number,
  field: "email" | "mobile",
  provider: string,
  outcome: "found" | "no_match" | "rejected" | "error" | "skipped",
  opts: { value?: string | null; creditsConsumed?: number; errorMessage?: string | null } = {},
) {
  await db.insert(enrichmentFieldEvents).values({
    enrichmentRowId: rowId,
    field,
    provider,
    outcome,
    value: opts.value ?? null,
    creditsConsumed: opts.creditsConsumed ?? 0,
    errorMessage: opts.errorMessage ?? null,
  });
}

async function pendingRows(runId: number, statusField: "emailStatus" | "mobileStatus"): Promise<EnrichmentRow[]> {
  return db
    .select()
    .from(enrichmentRows)
    .where(and(eq(enrichmentRows.runId, runId), eq(enrichmentRows[statusField], "pending")));
}

// Stage 1 (email only): check whether the linked HubSpot contact's own CRM
// record already has an email on file — the same "existing" fast-path the
// CLI pipeline got for free by reading the HubSpot export directly. Skips
// LeadMagic/Prospeo credits entirely for any row this resolves.
async function hubspotRematchStage(runId: number) {
  const rows = (await pendingRows(runId, "emailStatus")).filter((r) => r.contactId);
  if (rows.length === 0) return;

  const records = await batchReadObjects<{ email?: string }>(
    "contacts",
    rows.map((r) => r.contactId!),
    ["email"],
  );
  const emailByContactId = new Map(records.map((r) => [r.id, r.properties.email]));

  for (const row of rows) {
    const email = emailByContactId.get(row.contactId!);
    if (!email) continue;
    await db
      .update(enrichmentRows)
      .set({ emailStatus: "found", email, emailSource: "existing", updatedAt: new Date() })
      .where(eq(enrichmentRows.id, row.id));
    await logEvent(row.id, "email", "hubspot", "found", { value: email });
  }
}

async function leadmagicEmailStage(runId: number) {
  for (const row of await pendingRows(runId, "emailStatus")) {
    try {
      const result = await leadmagic.findEmail({
        firstName: row.firstName ?? "",
        lastName: row.lastName ?? "",
        domain: row.domain,
        companyName: row.companyName,
      });
      if (result.email) {
        await db
          .update(enrichmentRows)
          .set({
            emailStatus: "found",
            email: result.email,
            emailSource: "leadmagic",
            creditsConsumed: row.creditsConsumed + result.creditsConsumed,
            updatedAt: new Date(),
          })
          .where(eq(enrichmentRows.id, row.id));
        await logEvent(row.id, "email", "leadmagic", "found", {
          value: result.email,
          creditsConsumed: result.creditsConsumed,
        });
      } else {
        await logEvent(row.id, "email", "leadmagic", "no_match", { creditsConsumed: result.creditsConsumed });
      }
    } catch (err) {
      await logEvent(row.id, "email", "leadmagic", "error", {
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function prospeoEmailStage(runId: number) {
  for (const row of await pendingRows(runId, "emailStatus")) {
    try {
      const result = await prospeo.enrichPerson({
        firstName: row.firstName ?? "",
        lastName: row.lastName ?? "",
        companyName: row.companyName,
        companyWebsite: row.domain,
      });
      if (result.email) {
        await db
          .update(enrichmentRows)
          .set({ emailStatus: "found", email: result.email, emailSource: "prospeo", updatedAt: new Date() })
          .where(eq(enrichmentRows.id, row.id));
        await logEvent(row.id, "email", "prospeo", "found", { value: result.email });
      } else {
        await logEvent(row.id, "email", "prospeo", "no_match");
      }
    } catch (err) {
      await logEvent(row.id, "email", "prospeo", "error", {
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// Validates every email found by LeadMagic/Prospeo this run — "existing"
// HubSpot emails skip validation, same as the CLI pipeline never
// re-validated already-live CRM data.
async function zeroBounceStage(runId: number) {
  const rows = await db
    .select()
    .from(enrichmentRows)
    .where(
      and(
        eq(enrichmentRows.runId, runId),
        eq(enrichmentRows.emailStatus, "found"),
        isNull(enrichmentRows.emailZeroBounceStatus),
        inArray(enrichmentRows.emailSource, ["leadmagic", "prospeo"]),
      ),
    );

  for (const row of rows) {
    try {
      const result = await validateEmailOrSkip(row.email!);
      const acceptable = isAcceptableStatus(result.status, { isGuess: false });
      await db
        .update(enrichmentRows)
        .set({
          emailZeroBounceStatus: result.status,
          emailStatus: acceptable ? "found" : "rejected",
          updatedAt: new Date(),
        })
        .where(eq(enrichmentRows.id, row.id));
      await logEvent(row.id, "email", "zerobounce", acceptable ? "found" : "rejected", { value: result.status });
    } catch (err) {
      await logEvent(row.id, "email", "zerobounce", "error", {
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function leadmagicMobileStage(runId: number) {
  for (const row of await pendingRows(runId, "mobileStatus")) {
    if (!row.email) {
      await logEvent(row.id, "mobile", "leadmagic", "skipped", { errorMessage: "no email to look up mobile from" });
      continue;
    }
    try {
      const result = await leadmagic.findMobile({ workEmail: row.email });
      if (result.mobileNumber) {
        await db
          .update(enrichmentRows)
          .set({
            mobileStatus: "found",
            mobile: result.mobileNumber,
            mobileSource: "leadmagic",
            creditsConsumed: row.creditsConsumed + result.creditsConsumed,
            updatedAt: new Date(),
          })
          .where(eq(enrichmentRows.id, row.id));
        await logEvent(row.id, "mobile", "leadmagic", "found", {
          value: result.mobileNumber,
          creditsConsumed: result.creditsConsumed,
        });
      } else {
        await logEvent(row.id, "mobile", "leadmagic", "no_match", { creditsConsumed: result.creditsConsumed });
      }
    } catch (err) {
      await logEvent(row.id, "mobile", "leadmagic", "error", {
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function prospeoMobileStage(runId: number) {
  for (const row of await pendingRows(runId, "mobileStatus")) {
    try {
      const result = await prospeo.findMobile({
        firstName: row.firstName ?? "",
        lastName: row.lastName ?? "",
        companyName: row.companyName,
        companyWebsite: row.domain,
      });
      if (result.mobile) {
        await db
          .update(enrichmentRows)
          .set({ mobileStatus: "found", mobile: result.mobile, mobileSource: "prospeo", updatedAt: new Date() })
          .where(eq(enrichmentRows.id, row.id));
        await logEvent(row.id, "mobile", "prospeo", "found", { value: result.mobile });
      } else {
        await logEvent(row.id, "mobile", "prospeo", "no_match");
      }
    } catch (err) {
      await logEvent(row.id, "mobile", "prospeo", "error", {
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// Anything still 'pending' after its waterfall ran genuinely exhausted every
// provider — mark it 'no_match' rather than leaving it 'pending' forever, so
// the run can reach a terminal state.
async function closeOutPending(runId: number) {
  await db
    .update(enrichmentRows)
    .set({ emailStatus: "no_match", updatedAt: new Date() })
    .where(and(eq(enrichmentRows.runId, runId), eq(enrichmentRows.emailStatus, "pending")));
  await db
    .update(enrichmentRows)
    .set({ mobileStatus: "no_match", updatedAt: new Date() })
    .where(and(eq(enrichmentRows.runId, runId), eq(enrichmentRows.mobileStatus, "pending")));
}

// Triggered identically by the manual "Start enrichment" server action and
// the future chat panel's start_enrichment_run tool — event payload is just
// { runId }, the enrichment_rows for that run are the sole input, mirroring
// how lib/sync.ts's runSyncJob() is the single entry point for both the cron
// route and the manual sync button.
export const enrichmentWaterfall = inngest.createFunction(
  { id: "enrichment-waterfall", triggers: [{ event: "enrichment/run.requested" }] },
  async ({ event, step }) => {
    const runId = event.data.runId as number;

    try {
      await step.run("mark-running", async () => {
        await db
          .update(enrichmentRuns)
          .set({ status: "running", currentStage: "hubspot_rematch" })
          .where(eq(enrichmentRuns.id, runId));
      });

      await step.run("hubspot-rematch", () => hubspotRematchStage(runId));

      await step.run("set-stage-leadmagic-email", async () => {
        await db.update(enrichmentRuns).set({ currentStage: "leadmagic_email" }).where(eq(enrichmentRuns.id, runId));
      });
      await step.run("leadmagic-email", () => leadmagicEmailStage(runId));
      await step.sleep("rate-limit-leadmagic-email", "300ms");

      await step.run("set-stage-prospeo-email", async () => {
        await db.update(enrichmentRuns).set({ currentStage: "prospeo_email" }).where(eq(enrichmentRuns.id, runId));
      });
      await step.run("prospeo-email", () => prospeoEmailStage(runId));
      await step.sleep("rate-limit-prospeo-email", "300ms");

      await step.run("set-stage-zerobounce", async () => {
        await db.update(enrichmentRuns).set({ currentStage: "zerobounce" }).where(eq(enrichmentRuns.id, runId));
      });
      await step.run("zerobounce", () => zeroBounceStage(runId));
      await step.sleep("rate-limit-zerobounce", "300ms");

      await step.run("set-stage-leadmagic-mobile", async () => {
        await db.update(enrichmentRuns).set({ currentStage: "leadmagic_mobile" }).where(eq(enrichmentRuns.id, runId));
      });
      await step.run("leadmagic-mobile", () => leadmagicMobileStage(runId));
      await step.sleep("rate-limit-leadmagic-mobile", "300ms");

      await step.run("set-stage-prospeo-mobile", async () => {
        await db.update(enrichmentRuns).set({ currentStage: "prospeo_mobile" }).where(eq(enrichmentRuns.id, runId));
      });
      await step.run("prospeo-mobile", () => prospeoMobileStage(runId));

      await step.run("finalize", async () => {
        await closeOutPending(runId);
        const rows = await db.select().from(enrichmentRows).where(eq(enrichmentRows.runId, runId));
        const hasProviderErrors = await db
          .select({ id: enrichmentFieldEvents.id })
          .from(enrichmentFieldEvents)
          .innerJoin(enrichmentRows, eq(enrichmentFieldEvents.enrichmentRowId, enrichmentRows.id))
          .where(and(eq(enrichmentRows.runId, runId), eq(enrichmentFieldEvents.outcome, "error")))
          .limit(1);

        await db
          .update(enrichmentRuns)
          .set({
            status: hasProviderErrors.length > 0 ? "partial" : "success",
            currentStage: null,
            processedRows: rows.length,
            finishedAt: new Date(),
          })
          .where(eq(enrichmentRuns.id, runId));
      });

      return { runId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await step.run("mark-error", async () => {
        await db
          .update(enrichmentRuns)
          .set({ status: "error", errorMessage: message, finishedAt: new Date() })
          .where(eq(enrichmentRuns.id, runId));
      });
      throw err;
    }
  },
);
