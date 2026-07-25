import { db } from "@/lib/db";
import { campaignCompanies, campaigns, companies, contacts, owners, syncRuns } from "@/lib/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, sql } from "drizzle-orm";
import { hubspotContactUrl } from "@/lib/hubspot";

export type EngagementStatus =
  | "unengaged"
  | "not_interested"
  | "unqualified"
  | "activated_lead"
  | "meeting_booked";

export const ENGAGEMENT_STATUSES: EngagementStatus[] = [
  "unengaged",
  "not_interested",
  "unqualified",
  "activated_lead",
  "meeting_booked",
];

export const ENGAGEMENT_LABELS: Record<EngagementStatus, string> = {
  unengaged: "Unengaged",
  not_interested: "Not Interested",
  unqualified: "Unqualified",
  activated_lead: "Activated Lead",
  meeting_booked: "Meeting Booked",
};

export async function getLastSyncRun() {
  const [run] = await db
    .select()
    .from(syncRuns)
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  return run ?? null;
}

// "Enrolled" means actively being worked (hs_lead_status = IN_PROGRESS), not
// just present on the HubSpot list — a list can include contacts that are
// brand new, already resolved (not interested/unqualified), etc.
const IN_PROGRESS = eq(contacts.leadStatus, "IN_PROGRESS");

export async function getFunnelCounts(campaignId?: number) {
  const contactWhere = campaignId ? eq(contacts.campaignId, campaignId) : undefined;
  const [contactAgg] = await db
    .select({
      enrolled: sql<number>`count(*) filter (where ${IN_PROGRESS})`.mapWith(Number),
      callsMade: sql<number>`count(*) filter (where ${contacts.hasCallLogged})`.mapWith(Number),
      connects: sql<number>`count(*) filter (where ${contacts.lastCallConnected})`.mapWith(Number),
      replies: sql<number>`count(*) filter (where ${contacts.hasGenuineReply})`.mapWith(Number),
      meetings: sql<number>`count(*) filter (where ${contacts.meetingBooked})`.mapWith(Number),
    })
    .from(contacts)
    .where(contactWhere);

  const companyWhere = campaignId ? eq(campaignCompanies.campaignId, campaignId) : undefined;
  const [companyAgg] = await db
    .select({
      companiesTargeted: sql<number>`count(*)`.mapWith(Number),
      companiesEngaged: sql<number>`count(*) filter (where ${campaignCompanies.engagementStatus} != 'unengaged')`.mapWith(
        Number,
      ),
    })
    .from(campaignCompanies)
    .where(companyWhere);

  return {
    enrolled: contactAgg?.enrolled ?? 0,
    callsMade: contactAgg?.callsMade ?? 0,
    connects: contactAgg?.connects ?? 0,
    replies: contactAgg?.replies ?? 0,
    meetings: contactAgg?.meetings ?? 0,
    companiesTargeted: companyAgg?.companiesTargeted ?? 0,
    companiesEngaged: companyAgg?.companiesEngaged ?? 0,
    companiesUnengaged: (companyAgg?.companiesTargeted ?? 0) - (companyAgg?.companiesEngaged ?? 0),
  };
}

export async function getEngagementBreakdown(
  campaignId?: number,
): Promise<Record<EngagementStatus, number>> {
  const where = campaignId ? eq(campaignCompanies.campaignId, campaignId) : undefined;
  const rows = await db
    .select({
      status: campaignCompanies.engagementStatus,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(campaignCompanies)
    .where(where)
    .groupBy(campaignCompanies.engagementStatus);

  const result = Object.fromEntries(ENGAGEMENT_STATUSES.map((s) => [s, 0])) as Record<
    EngagementStatus,
    number
  >;
  for (const r of rows) result[r.status as EngagementStatus] = r.count;
  return result;
}

// Calls/meetings are attributed to whoever the activity itself is assigned
// to (call_owner_id / meeting_owner_id) — a contact's CRM owner is often a
// completely different, unrelated person from an older process. "Enrolled"
// and "replies" have no independent per-contact "who" signal at all, so
// instead of the (confusing) contact-owner fallback, they're attributed
// wholesale to that contact's *campaign's* owner (Settings > campaign owner),
// resolved to a HubSpot owner via matching email where possible so it merges
// into the same row as that person's call/meeting activity.
export async function getRepBreakdown(campaignId?: number) {
  const campaignFilter = campaignId ? sql`and c.campaign_id = ${campaignId}` : sql``;

  const result = await db.execute<{
    owner_id: string;
    owner_name: string | null;
    enrolled: number;
    calls_made: number;
    connects: number;
    replies: number;
    meetings: number;
  }>(sql`
    with resolved as (
      select
        c.*,
        coalesce(co.hubspot_owner_id, cm.owner_name) as campaign_owner_id,
        coalesce(co.name, cm.owner_name) as campaign_owner_name
      from contacts c
      join campaigns cm on cm.id = c.campaign_id
      left join owners co on lower(co.email) = lower(cm.owner_email)
      where 1=1 ${campaignFilter}
    ),
    owner_ids as (
      select call_owner_id as id from resolved where call_owner_id is not null
      union
      select connected_call_owner_id as id from resolved where connected_call_owner_id is not null
      union
      select meeting_owner_id as id from resolved where meeting_owner_id is not null
      union
      select campaign_owner_id as id from resolved where campaign_owner_id is not null
    )
    select
      oi.id as owner_id,
      coalesce(
        o.name,
        (select r.campaign_owner_name from resolved r where r.campaign_owner_id = oi.id limit 1)
      ) as owner_name,
      (select count(*) from resolved r where r.campaign_owner_id = oi.id and r.lead_status = 'IN_PROGRESS') as enrolled,
      (select count(*) from resolved r where r.call_owner_id = oi.id and r.has_call_logged) as calls_made,
      (select count(*) from resolved r where r.connected_call_owner_id = oi.id and r.last_call_connected) as connects,
      (select count(*) from resolved r where r.campaign_owner_id = oi.id and r.has_genuine_reply) as replies,
      (select count(*) from resolved r where r.meeting_owner_id = oi.id and r.meeting_booked) as meetings
    from owner_ids oi
    left join owners o on o.hubspot_owner_id = oi.id
    order by calls_made desc, enrolled desc
  `);

  return result.map((r) => ({
    ownerId: r.owner_id,
    ownerName: r.owner_name ?? "Unassigned",
    enrolled: Number(r.enrolled),
    callsMade: Number(r.calls_made),
    connects: Number(r.connects),
    replies: Number(r.replies),
    meetings: Number(r.meetings),
  }));
}

export async function getCompanyRollup(campaignId: number) {
  const rows = await db
    .select({
      companyId: campaignCompanies.companyId,
      companyName: companies.name,
      industry: companies.industry,
      engagementStatus: campaignCompanies.engagementStatus,
      statusUpdatedAt: campaignCompanies.statusUpdatedAt,
      contactCount: sql<number>`(select count(*) from ${contacts} where ${contacts.companyId} = ${campaignCompanies.companyId} and ${contacts.campaignId} = ${campaignCompanies.campaignId})`.mapWith(
        Number,
      ),
    })
    .from(campaignCompanies)
    .leftJoin(companies, eq(campaignCompanies.companyId, companies.hubspotCompanyId))
    .where(eq(campaignCompanies.campaignId, campaignId))
    .orderBy(companies.name);

  return rows.map((r) => ({ ...r, companyName: r.companyName ?? `Unknown company (${r.companyId})` }));
}

export async function getCampaignsWithCounts() {
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      hubspotListId: campaigns.hubspotListId,
      sequenceLabel: campaigns.sequenceLabel,
      ownerName: campaigns.ownerName,
      ownerEmail: campaigns.ownerEmail,
      targetCount: campaigns.targetCount,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      status: campaigns.status,
      delivered: sql<number>`(select count(*) from ${contacts} where ${contacts.campaignId} = ${campaigns.id})`.mapWith(
        Number,
      ),
    })
    .from(campaigns)
    .orderBy(desc(campaigns.createdAt));

  return rows;
}

export async function getCampaign(id: number) {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  return row ?? null;
}

export type DrillDownMetric = "enrolled" | "calls" | "connects" | "replies" | "meetings";

const callOwners = alias(owners, "call_owners");
const connectedCallOwners = alias(owners, "connected_call_owners");
const meetingOwners = alias(owners, "meeting_owners");

// Backs the click-through popover on each stat tile — "who exactly is behind
// this number," grouped/sorted by outcome so counts per disposition are
// visible at a glance. Reply channel (email vs. call) isn't a field HubSpot
// exposes directly — it's inferred: a contact who connected by call within
// the window almost certainly replied via that conversation, not email, so
// their reply is attributed to the call; anyone else who auto-unenrolled
// without a call connect replied via email.
export async function getContactsForMetric(metric: DrillDownMetric, campaignId?: number) {
  const metricWhere = {
    enrolled: eq(contacts.leadStatus, "IN_PROGRESS"),
    calls: eq(contacts.hasCallLogged, true),
    connects: eq(contacts.lastCallConnected, true),
    replies: eq(contacts.hasGenuineReply, true),
    meetings: eq(contacts.meetingBooked, true),
  }[metric];

  // Always fetch both the "most recent call overall" and "most recent
  // CONNECTED call" fields and pick per-row below — a "connects" or
  // "Call reply" row must show the connecting call's own disposition/time,
  // never a later unrelated call's (e.g. a no-answer follow-up), even though
  // "calls made" legitimately wants the latest call regardless of outcome.
  const rows = await db
    .select({
      hubspotContactId: contacts.hubspotContactId,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      jobTitle: contacts.jobTitle,
      leadStatus: contacts.leadStatus,
      companyName: companies.name,
      lastCallDispositionLabel: contacts.lastCallDispositionLabel,
      lastCallAt: contacts.lastCallAt,
      lastConnectedCallDispositionLabel: contacts.lastConnectedCallDispositionLabel,
      lastConnectedCallAt: contacts.lastConnectedCallAt,
      lastMeetingAt: contacts.lastMeetingAt,
      hasGenuineReply: contacts.hasGenuineReply,
      lastCallConnected: contacts.lastCallConnected,
      callOwnerName: callOwners.name,
      connectedCallOwnerName: connectedCallOwners.name,
      meetingOwnerName: meetingOwners.name,
      campaignOwnerName: campaigns.ownerName,
    })
    .from(contacts)
    .innerJoin(campaigns, eq(contacts.campaignId, campaigns.id))
    .leftJoin(companies, eq(contacts.companyId, companies.hubspotCompanyId))
    .leftJoin(callOwners, eq(contacts.callOwnerId, callOwners.hubspotOwnerId))
    .leftJoin(connectedCallOwners, eq(contacts.connectedCallOwnerId, connectedCallOwners.hubspotOwnerId))
    .leftJoin(meetingOwners, eq(contacts.meetingOwnerId, meetingOwners.hubspotOwnerId))
    .where(campaignId ? and(eq(contacts.campaignId, campaignId), metricWhere) : metricWhere)
    .orderBy(
      metric === "calls" ? contacts.lastCallDispositionLabel : sql`1`,
      metric === "connects" ? contacts.lastConnectedCallDispositionLabel : sql`1`,
      metric === "enrolled" ? contacts.leadStatus : sql`1`,
      metric === "replies" ? contacts.lastCallConnected : sql`1`,
      contacts.lastName,
      contacts.firstName,
    );

  const mapped = rows.map((r) => {
    const isCallReply = metric === "replies" && r.lastCallConnected;
    const useConnectedCall = metric === "connects" || isCallReply;

    const owner =
      metric === "calls"
        ? r.callOwnerName
        : metric === "connects" || isCallReply
          ? r.connectedCallOwnerName
          : metric === "meetings"
            ? r.meetingOwnerName
            : r.campaignOwnerName;

    return {
      hubspotContactId: r.hubspotContactId,
      name: [r.firstName, r.lastName].filter(Boolean).join(" ") || "(no name)",
      jobTitle: r.jobTitle,
      leadStatus: r.leadStatus,
      companyName: r.companyName,
      dispositionLabel: useConnectedCall ? r.lastConnectedCallDispositionLabel : r.lastCallDispositionLabel,
      lastCallAt: useConnectedCall ? r.lastConnectedCallAt : r.lastCallAt,
      lastMeetingAt: r.lastMeetingAt,
      replyChannel: metric === "replies" ? (isCallReply ? "Call reply" : "Email reply") : null,
      ownerName: owner ?? "Unassigned",
      hubspotUrl: hubspotContactUrl(r.hubspotContactId),
    };
  });

  // Outcome counts for the summary header — dispositionLabel for
  // calls/connects, leadStatus for enrolled, inferred channel for replies;
  // meetings don't vary by outcome so no summary is shown there.
  const outcomeKey =
    metric === "calls" || metric === "connects"
      ? "dispositionLabel"
      : metric === "enrolled"
        ? "leadStatus"
        : metric === "replies"
          ? "replyChannel"
          : null;
  const outcomeCounts: Record<string, number> = {};
  if (outcomeKey) {
    for (const row of mapped) {
      const key = (row as unknown as Record<string, string | null>)[outcomeKey] ?? "No disposition logged";
      outcomeCounts[key] = (outcomeCounts[key] ?? 0) + 1;
    }
  }

  return { rows: mapped, outcomeCounts };
}
