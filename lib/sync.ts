import { db } from "@/lib/db";
import { campaignCompanies, companies, contacts, owners, syncRuns } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  batchReadAssociations,
  batchReadObjects,
  getCallDispositionOptions,
  getListMemberIds,
  listOwners,
} from "@/lib/hubspot";
import { getAuthorityKeywords, isAuthorityTitle } from "@/lib/authority";

type Outcome = "not_interested" | "unqualified" | "activated_lead" | "meeting_booked";

// Classification of this portal's actual call disposition labels (confirmed
// live via GET /calling/v1/dispositions): Busy, Connected, Connected - 01 -
// Pitch, Connected - 02 - Past Pitch, Connected - 03 - Meeting, Connected -
// 04 - Wrong Title, Left live message, Left voicemail, No answer, Wrong
// number. Only used to detect "connected" for the calls funnel now —
// not_interested/unqualified come from `hs_lead_status` instead (see below),
// which is real, populated, portal data rather than an inferred guess.
function classifyDispositionLabel(label: string): "connected" | "other" {
  return label.toLowerCase().includes("connect") ? "connected" : "other";
}

// hs_lead_status is the authoritative signal for terminal outcomes — verified
// live against real contacts in this portal: NEW, IN_PROGRESS, OPEN_DEAL,
// "Not Interested", "Unqualified" (the last two are literal mixed-case
// values, not the enum-style casing of the first three).
function outcomeFromLeadStatus(leadStatus: string | undefined): Outcome | null {
  switch (leadStatus) {
    case "Not Interested":
      return "not_interested";
    case "Unqualified":
      return "unqualified";
    case "OPEN_DEAL":
      return "activated_lead";
    default:
      return null;
  }
}

// Fixed priority when a company has multiple authority contacts with
// different signals — a real, dated meeting/deal beats a lead-status guess,
// and lead-status outcomes don't carry a reliable "when did this happen"
// timestamp from the API, so ranking replaces the old "most recent wins" comparison.
const OUTCOME_RANK: Record<Outcome, number> = {
  meeting_booked: 4,
  activated_lead: 3,
  not_interested: 2,
  unqualified: 1,
};

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// A campaign's start/end date scopes which *activity* counts toward it —
// without this, a contact's entire lifetime history (calls/replies/meetings
// from a completely unrelated earlier campaign) bleeds into this campaign's
// numbers just because they're currently on its list. List membership itself
// is NOT date-filtered (being on the list today is what makes someone a
// target), only the calls/meetings/deals/replies used to compute funnel and
// engagement-status signals are. No startDate configured = no filtering
// (backward compatible for campaigns that haven't set one).
function withinCampaignWindow(
  isoDate: string | null | undefined,
  startDate: string | null,
  endDate: string | null,
): boolean {
  if (!startDate) return true;
  if (!isoDate) return false;
  const t = Date.parse(isoDate);
  if (Number.isNaN(t)) return false;
  if (t < Date.parse(startDate)) return false;
  const end = endDate ? Date.parse(`${endDate}T23:59:59`) : Date.now();
  if (t > end) return false;
  return true;
}

// "Genuine reply" is inferred from sequence auto-unenrollment rather than
// reading email content (avoids needing the emails-read scope entirely):
// HubSpot auto-unenrolls a contact from a sequence when they reply. Verified
// live against this portal's actual contact properties — there's no exposed
// "unenroll reason" field, so this reconstructs it: unenrolled (not currently
// enrolled), never reached a natural finish, and not explained by an opt-out
// or hard bounce. NOTE: `hs_email_optout_219647228` is this portal's specific
// "One to One" subscription-type opt-out property ID — it's portal-specific
// and would need re-verifying if this is ever pointed at a different HubSpot account.
type ContactSequenceProps = {
  hs_sequences_is_enrolled?: string;
  hs_latest_sequence_unenrolled_date?: string;
  hs_latest_sequence_finished_date?: string;
  hs_email_optout?: string;
  hs_email_optout_219647228?: string;
  hs_email_hard_bounce_reason_enum?: string;
};

function inferGenuineReply(
  props: ContactSequenceProps,
  startDate: string | null,
  endDate: string | null,
): boolean {
  const stillEnrolled = props.hs_sequences_is_enrolled === "true";
  if (stillEnrolled) return false;
  if (!props.hs_latest_sequence_unenrolled_date) return false;
  if (props.hs_latest_sequence_finished_date) return false; // ran to a natural finish
  const optedOut =
    props.hs_email_optout === "true" || props.hs_email_optout_219647228 === "true";
  const bounced = Boolean(props.hs_email_hard_bounce_reason_enum);
  if (optedOut || bounced) return false;
  return withinCampaignWindow(props.hs_latest_sequence_unenrolled_date, startDate, endDate);
}

export async function runSync(options?: { campaignIds?: number[] }) {
  const dispositionOptions = await getCallDispositionOptions().catch(() => []);
  const dispositionClass = new Map(
    dispositionOptions.map((o) => [o.value, classifyDispositionLabel(o.label)]),
  );

  const hsOwners = await listOwners().catch(() => []);
  if (hsOwners.length > 0) {
    const ownerRows = hsOwners.map((o) => ({
      hubspotOwnerId: o.id,
      name: [o.firstName, o.lastName].filter(Boolean).join(" ") || o.email || o.id,
      email: o.email ?? null,
    }));
    for (const batch of chunkArray(ownerRows, 200)) {
      await db
        .insert(owners)
        .values(batch)
        .onConflictDoUpdate({
          target: owners.hubspotOwnerId,
          set: { name: sql`excluded.name`, email: sql`excluded.email` },
        });
    }
  }

  const authorityKeywords = await getAuthorityKeywords();
  const allCampaigns = options?.campaignIds
    ? await db.query.campaigns.findMany({
        where: (c, { inArray }) => inArray(c.id, options.campaignIds!),
      })
    : await db.query.campaigns.findMany();

  // One campaign failing (bad list ID, a transient HubSpot error, etc.) must
  // not prevent every other campaign from syncing — isolate failures per
  // campaign instead of letting one throw abort the whole run.
  const failed: Array<{ campaignId: number; name: string; error: string }> = [];
  for (const campaign of allCampaigns) {
    try {
      await syncCampaign(
        campaign.id,
        campaign.hubspotListId,
        campaign.startDate,
        campaign.endDate,
        authorityKeywords,
        dispositionClass,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[sync] campaign ${campaign.id} (${campaign.name}) failed:`, message);
      failed.push({ campaignId: campaign.id, name: campaign.name, error: message });
    }
  }

  return { total: allCampaigns.length, failed };
}

async function syncCampaign(
  campaignId: number,
  hubspotListId: string,
  startDate: string | null,
  endDate: string | null,
  authorityKeywords: string[],
  dispositionClass: Map<string, "connected" | "other">,
) {
  const contactIds = await getListMemberIds(hubspotListId);
  if (contactIds.length === 0) return;

  const contactRecords = await batchReadObjects<
    {
      firstname?: string;
      lastname?: string;
      jobtitle?: string;
      hubspot_owner_id?: string;
      hs_lead_status?: string;
    } & ContactSequenceProps
  >("contacts", contactIds, [
    "firstname",
    "lastname",
    "jobtitle",
    "hubspot_owner_id",
    "hs_lead_status",
    "hs_sequences_is_enrolled",
    "hs_latest_sequence_unenrolled_date",
    "hs_latest_sequence_finished_date",
    "hs_email_optout",
    "hs_email_optout_219647228",
    "hs_email_hard_bounce_reason_enum",
  ]);

  const [contactToCompany, contactToCalls, contactToMeetings] = await Promise.all([
    batchReadAssociations("contacts", "companies", contactIds),
    batchReadAssociations("contacts", "calls", contactIds),
    batchReadAssociations("contacts", "meetings", contactIds),
  ]);

  const allCallIds = unique(Array.from(contactToCalls.values()).flat());
  const allMeetingIds = unique(Array.from(contactToMeetings.values()).flat());
  const allCompanyIds = unique(Array.from(contactToCompany.values()).flat());

  // Each engagement type is fetched independently so a scope gap or outage on
  // one object type degrades that signal to empty rather than failing the
  // whole campaign sync.
  function safeBatchReadObjects<P extends Record<string, unknown>>(
    objectType: string,
    ids: string[],
    properties: string[],
  ) {
    return batchReadObjects<P>(objectType, ids, properties).catch((err) => {
      console.warn(`[sync] ${objectType} batch read failed, treating as empty:`, err);
      return [] as Array<{ id: string; properties: P }>;
    });
  }

  const [callRecords, meetingRecords, companyRecords] = await Promise.all([
    safeBatchReadObjects<{
      hs_call_disposition?: string;
      hs_timestamp?: string;
      hubspot_owner_id?: string;
    }>("calls", allCallIds, ["hs_call_disposition", "hs_timestamp", "hubspot_owner_id"]),
    safeBatchReadObjects<{ hs_timestamp?: string; hubspot_owner_id?: string }>(
      "meetings",
      allMeetingIds,
      ["hs_timestamp", "hubspot_owner_id"],
    ),
    safeBatchReadObjects<{ name?: string; industry?: string }>("companies", allCompanyIds, [
      "name",
      "industry",
    ]),
  ]);

  const callsById = new Map(callRecords.map((r) => [r.id, r.properties]));
  const meetingsById = new Map(meetingRecords.map((r) => [r.id, r.properties]));

  if (companyRecords.length > 0) {
    const companyRows = companyRecords.map((c) => ({
      hubspotCompanyId: c.id,
      name: c.properties.name || c.id,
      industry: c.properties.industry ?? null,
    }));
    for (const batch of chunkArray(companyRows, 200)) {
      await db
        .insert(companies)
        .values(batch)
        .onConflictDoUpdate({
          target: companies.hubspotCompanyId,
          set: { name: sql`excluded.name`, industry: sql`excluded.industry` },
        });
    }
  }

  // company -> best (outcome, contactId) among authority contacts, ranked by OUTCOME_RANK
  const companyOutcomes = new Map<string, { outcome: Outcome; contactId: string }>();
  const contactRows: (typeof contacts.$inferInsert)[] = [];

  for (const c of contactRecords) {
    const companyId = contactToCompany.get(c.id)?.[0];
    const isAuthority = isAuthorityTitle(c.properties.jobtitle, authorityKeywords);

    const calls = (contactToCalls.get(c.id) ?? [])
      .map((id) => callsById.get(id))
      .filter((v): v is NonNullable<typeof v> => Boolean(v))
      .filter((call) => withinCampaignWindow(call.hs_timestamp, startDate, endDate));
    const meetings = (contactToMeetings.get(c.id) ?? [])
      .map((id) => meetingsById.get(id))
      .filter((v): v is NonNullable<typeof v> => Boolean(v))
      .filter((m) => withinCampaignWindow(m.hs_timestamp, startDate, endDate));

    const hasCallLogged = calls.length > 0;
    const lastCallConnected = calls.some(
      (call) =>
        call.hs_call_disposition && dispositionClass.get(call.hs_call_disposition) === "connected",
    );
    const hasGenuineReply = inferGenuineReply(c.properties, startDate, endDate);
    const meetingBooked = meetings.length > 0;

    // Attribute calls/meetings to whoever the activity is actually assigned
    // to ("Activity assigned to"), NOT the contact's CRM owner — those are
    // frequently different people (a contact can be owned by one rep while
    // someone else works it for this campaign). Picks the most recent
    // qualifying activity's owner when there are several.
    const latestCall = [...calls].sort(
      (a, b) => Date.parse(b.hs_timestamp ?? "") - Date.parse(a.hs_timestamp ?? ""),
    )[0];
    const latestMeeting = [...meetings].sort(
      (a, b) => Date.parse(b.hs_timestamp ?? "") - Date.parse(a.hs_timestamp ?? ""),
    )[0];

    contactRows.push({
      hubspotContactId: c.id,
      campaignId,
      companyId: companyId ?? null,
      ownerId: c.properties.hubspot_owner_id ?? null,
      firstName: c.properties.firstname ?? null,
      lastName: c.properties.lastname ?? null,
      jobTitle: c.properties.jobtitle ?? null,
      leadStatus: c.properties.hs_lead_status ?? null,
      isAuthority,
      hasCallLogged,
      lastCallConnected,
      callOwnerId: latestCall?.hubspot_owner_id ?? null,
      meetingOwnerId: latestMeeting?.hubspot_owner_id ?? null,
      hasGenuineReply,
      meetingBooked,
      lastSyncedAt: new Date(),
    });

    if (!isAuthority || !companyId) continue;

    const outcome: Outcome | null = meetingBooked
      ? "meeting_booked"
      : outcomeFromLeadStatus(c.properties.hs_lead_status);

    if (outcome) {
      const existing = companyOutcomes.get(companyId);
      if (!existing || OUTCOME_RANK[outcome] > OUTCOME_RANK[existing.outcome]) {
        companyOutcomes.set(companyId, { outcome, contactId: c.id });
      }
    }
  }

  // Bulk upsert in chunks instead of one round-trip per contact — at list
  // sizes in the hundreds, sequential per-row writes were slow enough to hit
  // the serverless function's execution time limit mid-sync, silently
  // leaving a campaign partially synced. A failed chunk retries row-by-row so
  // one bad row still can't take out the rest of the list.
  for (const batch of chunkArray(contactRows, 200)) {
    try {
      await db
        .insert(contacts)
        .values(batch)
        .onConflictDoUpdate({
          target: contacts.hubspotContactId,
          set: {
            campaignId: sql`excluded.campaign_id`,
            companyId: sql`excluded.company_id`,
            ownerId: sql`excluded.owner_id`,
            firstName: sql`excluded.first_name`,
            lastName: sql`excluded.last_name`,
            jobTitle: sql`excluded.job_title`,
            leadStatus: sql`excluded.lead_status`,
            isAuthority: sql`excluded.is_authority`,
            hasCallLogged: sql`excluded.has_call_logged`,
            lastCallConnected: sql`excluded.last_call_connected`,
            callOwnerId: sql`excluded.call_owner_id`,
            meetingOwnerId: sql`excluded.meeting_owner_id`,
            hasGenuineReply: sql`excluded.has_genuine_reply`,
            meetingBooked: sql`excluded.meeting_booked`,
            lastSyncedAt: sql`excluded.last_synced_at`,
          },
        });
    } catch (err) {
      console.warn(`[sync] contact batch upsert failed, retrying rows individually:`, err);
      for (const row of batch) {
        try {
          await db
            .insert(contacts)
            .values(row)
            .onConflictDoUpdate({ target: contacts.hubspotContactId, set: row });
        } catch (rowErr) {
          console.error(`[sync] contact ${row.hubspotContactId} upsert failed, skipping:`, rowErr);
        }
      }
    }
  }

  const campaignCompanyRows = allCompanyIds.map((companyId) => {
    const best = companyOutcomes.get(companyId);
    return {
      campaignId,
      companyId,
      engagementStatus: (best?.outcome ?? "unengaged") as Outcome | "unengaged",
      statusSourceContactId: best?.contactId ?? null,
      statusUpdatedAt: best ? new Date() : null,
    };
  });

  for (const batch of chunkArray(campaignCompanyRows, 200)) {
    try {
      await db
        .insert(campaignCompanies)
        .values(batch)
        .onConflictDoUpdate({
          target: [campaignCompanies.campaignId, campaignCompanies.companyId],
          set: {
            engagementStatus: sql`excluded.engagement_status`,
            statusSourceContactId: sql`excluded.status_source_contact_id`,
            statusUpdatedAt: sql`excluded.status_updated_at`,
          },
        });
    } catch (err) {
      console.warn(`[sync] campaign_companies batch upsert failed, retrying rows individually:`, err);
      for (const row of batch) {
        try {
          await db
            .insert(campaignCompanies)
            .values(row)
            .onConflictDoUpdate({
              target: [campaignCompanies.campaignId, campaignCompanies.companyId],
              set: row,
            });
        } catch (rowErr) {
          console.error(`[sync] campaign_companies ${row.companyId} upsert failed, skipping:`, rowErr);
        }
      }
    }
  }
}

// Shared entry point for both the cron-triggered route and any in-app manual
// trigger — records a `sync_runs` row so "last synced" / error state on the
// dashboard reflects every run consistently, regardless of who/what kicked it off.
export async function runSyncJob(options?: { campaignIds?: number[] }) {
  const [run] = await db.insert(syncRuns).values({ status: "running" }).returning();

  try {
    const result = await runSync(options);
    const hasFailures = result.failed.length > 0;
    await db
      .update(syncRuns)
      .set({
        status: hasFailures ? "error" : "success",
        errorMessage: hasFailures
          ? result.failed.map((f) => `${f.name} (#${f.campaignId}): ${f.error}`).join("; ")
          : null,
        finishedAt: new Date(),
      })
      .where(eq(syncRuns.id, run.id));
    return { ok: !hasFailures, syncRunId: run.id, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(syncRuns)
      .set({ status: "error", errorMessage: message, finishedAt: new Date() })
      .where(eq(syncRuns.id, run.id));
    return { ok: false, syncRunId: run.id, error: message };
  }
}
