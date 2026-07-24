import { db } from "@/lib/db";
import { campaignCompanies, companies, contacts, owners } from "@/lib/db/schema";
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
// number. There is no "Not Interested" disposition in this portal at all, so
// `not_interested` can never be produced by call-disposition inference today
// — it stays reachable in the schema/UI in case a disposition or other
// signal for it is added later. "Wrong Title" is the closest real signal to
// "wrong/unqualified contact," so it's mapped to `unqualified`.
function classifyDispositionLabel(
  label: string,
): "connected" | "not_interested" | "unqualified" | "other" {
  const l = label.toLowerCase();
  if (l.includes("wrong title")) return "unqualified";
  if (l.includes("not interest")) return "not_interested";
  if (l.includes("unqualif")) return "unqualified";
  if (l.includes("connect")) return "connected";
  return "other";
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
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

function inferGenuineReply(props: ContactSequenceProps): boolean {
  const stillEnrolled = props.hs_sequences_is_enrolled === "true";
  if (stillEnrolled) return false;
  if (!props.hs_latest_sequence_unenrolled_date) return false;
  if (props.hs_latest_sequence_finished_date) return false; // ran to a natural finish
  const optedOut =
    props.hs_email_optout === "true" || props.hs_email_optout_219647228 === "true";
  const bounced = Boolean(props.hs_email_hard_bounce_reason_enum);
  if (optedOut || bounced) return false;
  return true;
}

export async function runSync() {
  const dispositionOptions = await getCallDispositionOptions().catch(() => []);
  const dispositionClass = new Map(
    dispositionOptions.map((o) => [o.value, classifyDispositionLabel(o.label)]),
  );

  const hsOwners = await listOwners().catch(() => []);
  for (const o of hsOwners) {
    const name = [o.firstName, o.lastName].filter(Boolean).join(" ") || o.email || o.id;
    await db
      .insert(owners)
      .values({ hubspotOwnerId: o.id, name, email: o.email ?? null })
      .onConflictDoUpdate({
        target: owners.hubspotOwnerId,
        set: { name, email: o.email ?? null },
      });
  }

  const authorityKeywords = await getAuthorityKeywords();
  const allCampaigns = await db.query.campaigns.findMany();

  // One campaign failing (bad list ID, a transient HubSpot error, etc.) must
  // not prevent every other campaign from syncing — isolate failures per
  // campaign instead of letting one throw abort the whole run.
  const failed: Array<{ campaignId: number; name: string; error: string }> = [];
  for (const campaign of allCampaigns) {
    try {
      await syncCampaign(campaign.id, campaign.hubspotListId, authorityKeywords, dispositionClass);
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
  authorityKeywords: string[],
  dispositionClass: Map<string, "connected" | "not_interested" | "unqualified" | "other">,
) {
  const contactIds = await getListMemberIds(hubspotListId);
  if (contactIds.length === 0) return;

  const contactRecords = await batchReadObjects<
    {
      firstname?: string;
      lastname?: string;
      jobtitle?: string;
      hubspot_owner_id?: string;
    } & ContactSequenceProps
  >("contacts", contactIds, [
    "firstname",
    "lastname",
    "jobtitle",
    "hubspot_owner_id",
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
    safeBatchReadObjects<{ hs_call_disposition?: string; hs_timestamp?: string }>(
      "calls",
      allCallIds,
      ["hs_call_disposition", "hs_timestamp"],
    ),
    safeBatchReadObjects<{ hs_timestamp?: string }>("meetings", allMeetingIds, ["hs_timestamp"]),
    safeBatchReadObjects<{ createdate?: string }>("deals", allDealIds, ["createdate"]),
    safeBatchReadObjects<{ name?: string; industry?: string }>("companies", allCompanyIds, [
      "name",
      "industry",
    ]),
  ]);

  const callsById = new Map(callRecords.map((r) => [r.id, r.properties]));
  const meetingsById = new Map(meetingRecords.map((r) => [r.id, r.properties]));
  const dealsById = new Map(dealRecords.map((r) => [r.id, r.properties]));

  if (companyRecords.length > 0) {
    for (const c of companyRecords) {
      await db
        .insert(companies)
        .values({
          hubspotCompanyId: c.id,
          name: c.properties.name || c.id,
          industry: c.properties.industry ?? null,
        })
        .onConflictDoUpdate({
          target: companies.hubspotCompanyId,
          set: { name: c.properties.name || c.id, industry: c.properties.industry ?? null },
        });
    }
  }

  // company -> best (outcome, timestamp, sourceContactId) among authority contacts
  const companyOutcomes = new Map<
    string,
    { outcome: Outcome; ts: number; contactId: string }
  >();

  for (const c of contactRecords) {
    const companyId = contactToCompany.get(c.id)?.[0];
    const isAuthority = isAuthorityTitle(c.properties.jobtitle, authorityKeywords);

    const calls = (contactToCalls.get(c.id) ?? [])
      .map((id) => callsById.get(id))
      .filter((v): v is NonNullable<typeof v> => Boolean(v));
    const meetings = (contactToMeetings.get(c.id) ?? [])
      .map((id) => meetingsById.get(id))
      .filter((v): v is NonNullable<typeof v> => Boolean(v));
    const deals = (contactToDeals.get(c.id) ?? [])
      .map((id) => dealsById.get(id))
      .filter((v): v is NonNullable<typeof v> => Boolean(v));

    const hasCallLogged = calls.length > 0;
    const lastCallConnected = calls.some(
      (call) =>
        call.hs_call_disposition && dispositionClass.get(call.hs_call_disposition) === "connected",
    );
    const hasGenuineReply = inferGenuineReply(c.properties);
    const meetingBooked = meetings.length > 0;

    try {
      await db
        .insert(contacts)
        .values({
          hubspotContactId: c.id,
          campaignId,
          companyId: companyId ?? null,
          ownerId: c.properties.hubspot_owner_id ?? null,
          firstName: c.properties.firstname ?? null,
          lastName: c.properties.lastname ?? null,
          jobTitle: c.properties.jobtitle ?? null,
          isAuthority,
          hasCallLogged,
          lastCallConnected,
          hasGenuineReply,
          meetingBooked,
          lastSyncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: contacts.hubspotContactId,
          set: {
            campaignId,
            companyId: companyId ?? null,
            ownerId: c.properties.hubspot_owner_id ?? null,
            firstName: c.properties.firstname ?? null,
            lastName: c.properties.lastname ?? null,
            jobTitle: c.properties.jobtitle ?? null,
            isAuthority,
            hasCallLogged,
            lastCallConnected,
            hasGenuineReply,
            meetingBooked,
            lastSyncedAt: new Date(),
          },
        });
    } catch (err) {
      // One bad row (unexpected data shape, transient DB blip, etc.) must not
      // stop the rest of this campaign's contacts from syncing.
      console.error(`[sync] contact ${c.id} upsert failed, skipping:`, err);
      continue;
    }

    if (!isAuthority || !companyId) continue;

    // Terminal outcome for this contact, newest signal wins if multiple apply.
    let candidate: { outcome: Outcome; ts: number } | null = null;
    for (const m of meetings) {
      const ts = m.hs_timestamp ? Date.parse(m.hs_timestamp) : 0;
      if (!candidate || ts > candidate.ts) candidate = { outcome: "meeting_booked", ts };
    }
    if (!candidate) {
      for (const d of deals) {
        const ts = d.createdate ? Date.parse(d.createdate) : 0;
        if (!candidate || ts > candidate.ts) candidate = { outcome: "activated_lead", ts };
      }
    }
    if (!candidate) {
      for (const call of calls) {
        const cls = call.hs_call_disposition
          ? dispositionClass.get(call.hs_call_disposition)
          : undefined;
        if (cls === "not_interested" || cls === "unqualified") {
          const ts = call.hs_timestamp ? Date.parse(call.hs_timestamp) : 0;
          if (!candidate || ts > candidate.ts) candidate = { outcome: cls, ts };
        }
      }
    }

    if (candidate) {
      const existing = companyOutcomes.get(companyId);
      if (!existing || candidate.ts > existing.ts) {
        companyOutcomes.set(companyId, { ...candidate, contactId: c.id });
      }
    }
  }

  for (const companyId of allCompanyIds) {
    const best = companyOutcomes.get(companyId);
    try {
      await db
        .insert(campaignCompanies)
        .values({
          campaignId,
          companyId,
          engagementStatus: best?.outcome ?? "unengaged",
          statusSourceContactId: best?.contactId ?? null,
          statusUpdatedAt: best ? new Date(best.ts) : null,
        })
        .onConflictDoUpdate({
          target: [campaignCompanies.campaignId, campaignCompanies.companyId],
          set: {
            engagementStatus: best?.outcome ?? "unengaged",
            statusSourceContactId: best?.contactId ?? null,
            statusUpdatedAt: best ? new Date(best.ts) : null,
          },
        });
    } catch (err) {
      console.error(`[sync] campaign_companies upsert failed for company ${companyId}, skipping:`, err);
    }
  }
}
