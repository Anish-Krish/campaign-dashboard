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

export async function getFunnelCounts(campaignId?: number) {
  const contactWhere = campaignId ? eq(contacts.campaignId, campaignId) : undefined;
  const [contactAgg] = await db
    .select({
      enrolled: sql<number>`count(*)`.mapWith(Number),
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

export async function getRepBreakdown(campaignId?: number) {
  const where = campaignId ? eq(contacts.campaignId, campaignId) : undefined;
  const rows = await db
    .select({
      ownerId: contacts.ownerId,
      ownerName: owners.name,
      enrolled: sql<number>`count(*)`.mapWith(Number),
      callsMade: sql<number>`count(*) filter (where ${contacts.hasCallLogged})`.mapWith(Number),
      connects: sql<number>`count(*) filter (where ${contacts.lastCallConnected})`.mapWith(Number),
      replies: sql<number>`count(*) filter (where ${contacts.hasGenuineReply})`.mapWith(Number),
      meetings: sql<number>`count(*) filter (where ${contacts.meetingBooked})`.mapWith(Number),
    })
    .from(contacts)
    .leftJoin(owners, eq(contacts.ownerId, owners.hubspotOwnerId))
    .where(where)
    .groupBy(contacts.ownerId, owners.name)
    .orderBy(desc(sql`count(*)`));

  return rows.map((r) => ({ ...r, ownerName: r.ownerName ?? "Unassigned" }));
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
