import { db } from "@/lib/db";
import { callEvents, campaignCompanies, companies, contacts, meetingEvents, owners, syncRuns } from "@/lib/db/schema";
import { and, eq, notInArray, sql } from "drizzle-orm";
import {
  batchReadAssociations,
  batchReadObjects,
  getCallDispositionOptions,
  getListMemberIds,
  listOwners,
} from "@/lib/hubspot";
import { getAuthorityKeywords, isAuthorityTitle } from "@/lib/authority";
import { toTorontoDateStr } from "@/lib/timezone";

type Outcome = "not_interested" | "unqualified" | "activated_lead" | "meeting_booked";

// SQO/SQL pipeline definitions, per the user (verified against live
// GET /crm/v3/pipelines/deals for this portal — these IDs are portal-specific):
// SQO = a deal reached "Pre-Assessment Questions" or "System Overview" in the
// Marketing Pipeline (id 62788164). SQL = a deal exists anywhere in the Sales
// Pipeline (id "default"), any stage — reaching that pipeline at all is SQL.
const SQO_STAGE_IDS = new Set(["1129362176", "1129362177"]); // Pre-Assessment Questions, System Overview
const SALES_PIPELINE_ID = "default";

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

// Finer classification used only for the daily calls/connects chart's
// call_events rows — separate from classifyDispositionLabel above because
// "Wrong Title" already counts toward the app-wide Connects total (it
// contains "connect") and that's unchanged; this splits it out into its own
// bucket for the chart. "Wrong number" is deliberately NOT its own bucket
// here — a wrong number never actually reached anyone, so per the user it
// shouldn't be counted in Connects at all; it falls into "other" alongside
// no-answer/voicemail/busy, same as it already does everywhere else in the app.
function classifyForDailyChart(label: string): "connected" | "wrong" | "other" {
  const l = label.toLowerCase();
  if (l.includes("wrong title")) return "wrong";
  if (l.includes("connect")) return "connected";
  return "other";
}

// "Had a real conversation" — a strict subset of "connected" (per the user):
// bare "Connected" just means someone picked up, and "Connected - 04 - Wrong
// Title" means the pickup was the wrong person. These three specifically are
// dispositions the rep would only log after an actual back-and-forth.
// Exact-match against known portal labels (confirmed live via
// GET /calling/v1/dispositions), not substring matching.
const CONVERSATION_LABELS = new Set([
  "Connected - 01 - Pitch",
  "Connected - 02 - Past Pitch",
  "Connected - 03 - Meeting",
]);
function isConversation(label: string): boolean {
  return CONVERSATION_LABELS.has(label);
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
// startDate/endDate are calendar days as picked in the campaign form ("July
// 15" meaning July 15 in Toronto, not UTC) — compared by Toronto
// calendar-day string (see lib/timezone.ts) rather than raw UTC instants:
// the previous version parsed startDate as UTC midnight and endDate as the
// server runtime's local midnight (UTC on Vercel) with no 'Z', which put
// both boundaries ~4-5 hours off from actual Toronto day boundaries and
// could mis-bucket evening activity into the wrong day (or the wrong side
// of the window entirely).
function withinCampaignWindow(
  isoDate: string | null | undefined,
  startDate: string | null,
  endDate: string | null,
): boolean {
  if (!startDate) return true;
  if (!isoDate) return false;
  const t = Date.parse(isoDate);
  if (Number.isNaN(t)) return false;
  const activityDay = toTorontoDateStr(t);
  if (activityDay < startDate) return false;
  const endDay = endDate ?? toTorontoDateStr(Date.now());
  if (activityDay > endDay) return false;
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
  const dispositionLabelById = new Map(dispositionOptions.map((o) => [o.value, o.label]));

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
        dispositionLabelById,
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
  dispositionLabelById: Map<string, string>,
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

  const [contactToCompany, contactToCalls, contactToMeetings, contactToDeals] = await Promise.all([
    batchReadAssociations("contacts", "companies", contactIds),
    batchReadAssociations("contacts", "calls", contactIds),
    batchReadAssociations("contacts", "meetings", contactIds),
    batchReadAssociations("contacts", "deals", contactIds),
  ]);

  const allCallIds = unique(Array.from(contactToCalls.values()).flat());
  const allMeetingIds = unique(Array.from(contactToMeetings.values()).flat());
  const allDealIds = unique(Array.from(contactToDeals.values()).flat());
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

  const [callRecords, meetingRecords, dealRecords, companyRecords] = await Promise.all([
    safeBatchReadObjects<{
      hs_call_disposition?: string;
      hs_timestamp?: string;
      hubspot_owner_id?: string;
    }>("calls", allCallIds, ["hs_call_disposition", "hs_timestamp", "hubspot_owner_id"]),
    safeBatchReadObjects<{
      hs_timestamp?: string;
      hs_createdate?: string;
      hubspot_owner_id?: string;
      hs_meeting_outcome?: string;
    }>("meetings", allMeetingIds, ["hs_timestamp", "hs_createdate", "hubspot_owner_id", "hs_meeting_outcome"]),
    safeBatchReadObjects<{ pipeline?: string; dealstage?: string; createdate?: string }>(
      "deals",
      allDealIds,
      ["pipeline", "dealstage", "createdate"],
    ),
    safeBatchReadObjects<{ name?: string; industry?: string }>("companies", allCompanyIds, [
      "name",
      "industry",
    ]),
  ]);

  const callsById = new Map(callRecords.map((r) => [r.id, r.properties]));
  const meetingsById = new Map(meetingRecords.map((r) => [r.id, r.properties]));
  const dealsById = new Map(dealRecords.map((r) => [r.id, r.properties]));

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
  const callEventRows: (typeof callEvents.$inferInsert)[] = [];
  const seenCallIds = new Set<string>(); // a call can be associated with >1 contact; dedupe rows by call ID
  const meetingEventRows: (typeof meetingEvents.$inferInsert)[] = [];
  const seenMeetingIds = new Set<string>(); // same dedupe rationale as calls

  for (const c of contactRecords) {
    const companyId = contactToCompany.get(c.id)?.[0];
    const isAuthority = isAuthorityTitle(c.properties.jobtitle, authorityKeywords);

    const calls = (contactToCalls.get(c.id) ?? [])
      .map((id) => {
        const props = callsById.get(id);
        return props ? { id, ...props } : undefined;
      })
      .filter((v): v is NonNullable<typeof v> => Boolean(v))
      .filter((call) => withinCampaignWindow(call.hs_timestamp, startDate, endDate));
    // Scoped by hs_createdate (when the meeting was booked), not hs_timestamp
    // (when it's scheduled to occur) — unlike a call, a meeting is routinely
    // booked during the campaign for a date weeks out, which can land past
    // the campaign's end date and wrongly exclude a meeting that was very
    // much a result of working this campaign. Matches how deals are already
    // scoped by createdate, not close date, below.
    const meetings = (contactToMeetings.get(c.id) ?? [])
      .map((id) => {
        const props = meetingsById.get(id);
        return props ? { id, ...props } : undefined;
      })
      .filter((v): v is NonNullable<typeof v> => Boolean(v))
      .filter((m) => withinCampaignWindow(m.hs_createdate, startDate, endDate));
    const deals = (contactToDeals.get(c.id) ?? [])
      .map((id) => dealsById.get(id))
      .filter((v): v is NonNullable<typeof v> => Boolean(v))
      .filter((d) => withinCampaignWindow(d.createdate, startDate, endDate));

    const sqoReached = deals.some(
      (d) => d.pipeline === "62788164" && d.dealstage && SQO_STAGE_IDS.has(d.dealstage),
    );
    const sqlReached = deals.some((d) => d.pipeline === SALES_PIPELINE_ID);

    for (const call of calls) {
      if (seenCallIds.has(call.id)) continue;
      seenCallIds.add(call.id);
      const label = call.hs_call_disposition ? dispositionLabelById.get(call.hs_call_disposition) : undefined;
      callEventRows.push({
        hubspotCallId: call.id,
        campaignId,
        contactId: c.id,
        companyId: companyId ?? null,
        ownerId: call.hubspot_owner_id ?? null,
        dispositionLabel: label ?? null,
        dispositionCategory: classifyForDailyChart(label ?? ""),
        calledAt: call.hs_timestamp ? new Date(call.hs_timestamp) : null,
      });
    }

    for (const meeting of meetings) {
      if (seenMeetingIds.has(meeting.id)) continue;
      seenMeetingIds.add(meeting.id);
      meetingEventRows.push({
        hubspotMeetingId: meeting.id,
        campaignId,
        contactId: c.id,
        companyId: companyId ?? null,
        ownerId: meeting.hubspot_owner_id ?? null,
        outcome: meeting.hs_meeting_outcome ?? null,
        meetingAt: meeting.hs_timestamp ? new Date(meeting.hs_timestamp) : null,
      });
    }

    const connectedCalls = calls.filter(
      (call) =>
        call.hs_call_disposition && dispositionClass.get(call.hs_call_disposition) === "connected",
    );
    const hasCallLogged = calls.length > 0;
    const callCount = calls.length;
    const lastCallConnected = connectedCalls.length > 0;
    const hadConversation = connectedCalls.some((call) => {
      const label = call.hs_call_disposition ? dispositionLabelById.get(call.hs_call_disposition) : undefined;
      return label ? isConversation(label) : false;
    });
    const hasGenuineReply = inferGenuineReply(c.properties, startDate, endDate);
    const meetingBooked = meetings.length > 0;

    // Attribute calls/meetings to whoever the activity is actually assigned
    // to ("Activity assigned to"), NOT the contact's CRM owner — those are
    // frequently different people (a contact can be owned by one rep while
    // someone else works it for this campaign). Picks the most recent
    // qualifying activity when there are several — and for connects
    // specifically, "most recent" is scoped to connected calls only: a later
    // no-answer follow-up must not overwrite who made the actual connect or
    // what the connect's own disposition was.
    const byMostRecent = (a: { hs_timestamp?: string }, b: { hs_timestamp?: string }) =>
      Date.parse(b.hs_timestamp ?? "") - Date.parse(a.hs_timestamp ?? "");
    const latestCall = [...calls].sort(byMostRecent)[0];
    const latestConnectedCall = [...connectedCalls].sort(byMostRecent)[0];
    const latestMeeting = [...meetings].sort(byMostRecent)[0];

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
      callCount,
      lastCallConnected,
      callOwnerId: latestCall?.hubspot_owner_id ?? null,
      connectedCallOwnerId: latestConnectedCall?.hubspot_owner_id ?? null,
      meetingOwnerId: latestMeeting?.hubspot_owner_id ?? null,
      lastCallDispositionLabel: latestCall?.hs_call_disposition
        ? (dispositionLabelById.get(latestCall.hs_call_disposition) ?? null)
        : null,
      lastCallAt: latestCall?.hs_timestamp ? new Date(latestCall.hs_timestamp) : null,
      lastConnectedCallDispositionLabel: latestConnectedCall?.hs_call_disposition
        ? (dispositionLabelById.get(latestConnectedCall.hs_call_disposition) ?? null)
        : null,
      lastConnectedCallAt: latestConnectedCall?.hs_timestamp
        ? new Date(latestConnectedCall.hs_timestamp)
        : null,
      lastMeetingAt: latestMeeting?.hs_timestamp ? new Date(latestMeeting.hs_timestamp) : null,
      lastMeetingOutcome: latestMeeting?.hs_meeting_outcome ?? null,
      sqoReached,
      sqlReached,
      hasGenuineReply,
      meetingBooked,
      hadConversation,
      lastSyncedAt: new Date(),
    });

    if (!companyId) continue;
    if (!isAuthority && !meetingBooked) continue;

    // A booked meeting counts toward company engagement regardless of who at
    // the company took it — it's the highest-ranked outcome and an
    // unambiguous engagement signal even from a non-authority contact (e.g.
    // an accounting manager). Every other outcome is a lead-status guess and
    // stays gated to authority contacts only.
    const outcome: Outcome | null = meetingBooked
      ? "meeting_booked"
      : isAuthority
        ? outcomeFromLeadStatus(c.properties.hs_lead_status)
        : null;

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
            callCount: sql`excluded.call_count`,
            lastCallConnected: sql`excluded.last_call_connected`,
            callOwnerId: sql`excluded.call_owner_id`,
            connectedCallOwnerId: sql`excluded.connected_call_owner_id`,
            meetingOwnerId: sql`excluded.meeting_owner_id`,
            lastCallDispositionLabel: sql`excluded.last_call_disposition_label`,
            lastCallAt: sql`excluded.last_call_at`,
            lastConnectedCallDispositionLabel: sql`excluded.last_connected_call_disposition_label`,
            lastConnectedCallAt: sql`excluded.last_connected_call_at`,
            lastMeetingAt: sql`excluded.last_meeting_at`,
            lastMeetingOutcome: sql`excluded.last_meeting_outcome`,
            sqoReached: sql`excluded.sqo_reached`,
            sqlReached: sql`excluded.sql_reached`,
            hasGenuineReply: sql`excluded.has_genuine_reply`,
            meetingBooked: sql`excluded.meeting_booked`,
            hadConversation: sql`excluded.had_conversation`,
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

  for (const batch of chunkArray(callEventRows, 200)) {
    try {
      await db
        .insert(callEvents)
        .values(batch)
        .onConflictDoUpdate({
          target: callEvents.hubspotCallId,
          set: {
            campaignId: sql`excluded.campaign_id`,
            contactId: sql`excluded.contact_id`,
            companyId: sql`excluded.company_id`,
            ownerId: sql`excluded.owner_id`,
            dispositionLabel: sql`excluded.disposition_label`,
            dispositionCategory: sql`excluded.disposition_category`,
            calledAt: sql`excluded.called_at`,
          },
        });
    } catch (err) {
      console.warn(`[sync] call_events batch upsert failed, retrying rows individually:`, err);
      for (const row of batch) {
        try {
          await db.insert(callEvents).values(row).onConflictDoUpdate({ target: callEvents.hubspotCallId, set: row });
        } catch (rowErr) {
          console.error(`[sync] call_event ${row.hubspotCallId} upsert failed, skipping:`, rowErr);
        }
      }
    }
  }

  for (const batch of chunkArray(meetingEventRows, 200)) {
    try {
      await db
        .insert(meetingEvents)
        .values(batch)
        .onConflictDoUpdate({
          target: meetingEvents.hubspotMeetingId,
          set: {
            campaignId: sql`excluded.campaign_id`,
            contactId: sql`excluded.contact_id`,
            companyId: sql`excluded.company_id`,
            ownerId: sql`excluded.owner_id`,
            outcome: sql`excluded.outcome`,
            meetingAt: sql`excluded.meeting_at`,
          },
        });
    } catch (err) {
      console.warn(`[sync] meeting_events batch upsert failed, retrying rows individually:`, err);
      for (const row of batch) {
        try {
          await db
            .insert(meetingEvents)
            .values(row)
            .onConflictDoUpdate({ target: meetingEvents.hubspotMeetingId, set: row });
        } catch (rowErr) {
          console.error(`[sync] meeting_event ${row.hubspotMeetingId} upsert failed, skipping:`, rowErr);
        }
      }
    }
  }

  // Reconcile to current list membership: sync only ever upserted contacts
  // that are on the list *right now* — anyone removed from the HubSpot list
  // since the last sync (disqualified, moved off, etc.) would otherwise stay
  // in our DB forever, inflating every count that reads from `contacts`
  // (Calls Made, Companies Enrolled, ...). Safe because contactIds is
  // guaranteed non-empty here (syncCampaign returns early otherwise), so
  // this can never wipe a campaign's contacts on a failed/empty fetch.
  await db
    .delete(contacts)
    .where(and(eq(contacts.campaignId, campaignId), notInArray(contacts.hubspotContactId, contactIds)));

  // Same reconciliation for companies — but only if this sync actually
  // resolved at least one company, so a transient issue that legitimately
  // yields zero associations can't wipe every company row for the campaign.
  if (allCompanyIds.length > 0) {
    await db
      .delete(campaignCompanies)
      .where(
        and(eq(campaignCompanies.campaignId, campaignId), notInArray(campaignCompanies.companyId, allCompanyIds)),
      );
  }

  // Same reconciliation for call events — only guarded the same way, so a
  // sync that resolved zero calls (e.g. transient fetch issue) can't wipe a
  // campaign's call history.
  if (seenCallIds.size > 0) {
    await db
      .delete(callEvents)
      .where(
        and(eq(callEvents.campaignId, campaignId), notInArray(callEvents.hubspotCallId, [...seenCallIds])),
      );
  }

  // Same reconciliation for meeting events.
  if (seenMeetingIds.size > 0) {
    await db
      .delete(meetingEvents)
      .where(
        and(
          eq(meetingEvents.campaignId, campaignId),
          notInArray(meetingEvents.hubspotMeetingId, [...seenMeetingIds]),
        ),
      );
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
