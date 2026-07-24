import { db } from "@/lib/db";
import { campaignCompanies, campaigns, companies, contacts, owners, syncRuns } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";

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
// to (call_owner_id / meeting_owner_id), NOT the contact's CRM owner
// (owner_id) — those are frequently different people (e.g. a contact owned
// by one rep from an older process, actually worked by someone else for this
// campaign). "Enrolled" and "replies" stay attributed to the contact owner,
// since there's no independent "who" for those. Raw SQL because each metric
// aggregates against a different owner column.
export async function getRepBreakdown(campaignId?: number) {
  const campaignFilter = campaignId ? sql`and campaign_id = ${campaignId}` : sql``;

  const result = await db.execute<{
    owner_id: string;
    owner_name: string | null;
    enrolled: number;
    calls_made: number;
    connects: number;
    replies: number;
    meetings: number;
  }>(sql`
    with owner_ids as (
      select owner_id as id from contacts where owner_id is not null ${campaignFilter}
      union
      select call_owner_id as id from contacts where call_owner_id is not null ${campaignFilter}
      union
      select meeting_owner_id as id from contacts where meeting_owner_id is not null ${campaignFilter}
    )
    select
      oi.id as owner_id,
      o.name as owner_name,
      (select count(*) from contacts c where c.owner_id = oi.id and c.lead_status = 'IN_PROGRESS' ${campaignFilter}) as enrolled,
      (select count(*) from contacts c where c.call_owner_id = oi.id and c.has_call_logged ${campaignFilter}) as calls_made,
      (select count(*) from contacts c where c.call_owner_id = oi.id and c.last_call_connected ${campaignFilter}) as connects,
      (select count(*) from contacts c where c.owner_id = oi.id and c.has_genuine_reply ${campaignFilter}) as replies,
      (select count(*) from contacts c where c.meeting_owner_id = oi.id and c.meeting_booked ${campaignFilter}) as meetings
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
