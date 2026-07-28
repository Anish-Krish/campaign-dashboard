import { db } from "@/lib/db";
import { callEvents, campaignCompanies, campaigns, companies, contacts, owners, syncRuns } from "@/lib/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { hubspotContactUrl } from "@/lib/hubspot";
import { ENGAGEMENT_LABELS, ENGAGEMENT_STATUSES, type EngagementStatus } from "@/lib/engagement-constants";

export type { EngagementStatus } from "@/lib/engagement-constants";
export { ENGAGEMENT_LABELS, ENGAGEMENT_STATUSES } from "@/lib/engagement-constants";

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

// A COMPANY counts as "enrolled" once at least one of its contacts has been
// touched at all — left lead status "New" (in progress, or already resolved
// to Not Interested/Unqualified/Open Deal), or has a call/meeting logged.
// This is the denominator for the engaged/unengaged breakdown and the
// call-frequency summary — comparing against every company that ever showed
// up in the HubSpot list (most of which haven't been worked yet) made
// "unengaged" read as "we tried and failed" when it mostly meant "haven't started."
const ENROLLED_CONTACT_SQL = sql`((${contacts.leadStatus} is not null and ${contacts.leadStatus} != 'NEW') or ${contacts.hasCallLogged} or ${contacts.meetingBooked})`;

export async function getFunnelCounts(campaignId?: number) {
  const contactWhere = campaignId ? eq(contacts.campaignId, campaignId) : undefined;
  const [contactAgg] = await db
    .select({
      enrolled: sql<number>`count(*) filter (where ${IN_PROGRESS})`.mapWith(Number),
      // "Calls Made" is total call attempts (sum of call_count), not the
      // number of distinct contacts with >=1 call — a re-dial to someone who
      // didn't pick up is still a real call, and counting distinct contacts
      // made this look like it barely moved on a day with 100+ real dials.
      callsMade: sql<number>`coalesce(sum(${contacts.callCount}), 0)`.mapWith(Number),
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
      // NOTE: written with literal table-qualified column names (not drizzle
      // column-ref interpolation) — verified live that `${col} = ${col}`
      // interpolation inside `count(*) filter (where exists (...))`
      // specifically fails to correlate (drizzle renders both sides
      // unqualified, so it self-joins `contacts` against itself and always
      // matches). Plain `.where()` and scalar-subquery-in-select both
      // interpolate correctly — only this filter+exists combination doesn't.
      companiesEnrolled: sql<number>`count(*) filter (where exists (
        select 1 from contacts
        where contacts.campaign_id = campaign_companies.campaign_id
        and contacts.company_id = campaign_companies.company_id
        and ((contacts.lead_status is not null and contacts.lead_status != 'NEW') or contacts.has_call_logged or contacts.meeting_booked)
      ))`.mapWith(Number),
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
    companiesEnrolled: companyAgg?.companiesEnrolled ?? 0,
    companiesEngaged: companyAgg?.companiesEngaged ?? 0,
    companiesUnengaged: (companyAgg?.companiesEnrolled ?? 0) - (companyAgg?.companiesEngaged ?? 0),
  };
}

export async function getEngagementBreakdown(
  campaignId?: number,
): Promise<Record<EngagementStatus, number>> {
  const enrolledOnly = sql`exists (
    select 1 from ${contacts}
    where ${contacts.campaignId} = ${campaignCompanies.campaignId}
    and ${contacts.companyId} = ${campaignCompanies.companyId}
    and ${ENROLLED_CONTACT_SQL}
  )`;
  const where = campaignId ? and(eq(campaignCompanies.campaignId, campaignId), enrolledOnly) : enrolledOnly;
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
      (select coalesce(sum(r.call_count), 0) from resolved r where r.call_owner_id = oi.id) as calls_made,
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

// "Collectively across companies" view of authority-contact call frequency —
// among ENROLLED companies only (see ENROLLED_CONTACT_SQL above), how many
// have had their authority contact(s) called, and how many times. Grouped by
// (company_id, campaign_id) so the same company across two campaigns counts
// as two separate rows, consistent with how campaign_companies itself works.
export async function getCompanyEngagementSummary(campaignId?: number) {
  const campaignFilter = campaignId ? sql`and campaign_id = ${campaignId}` : sql``;

  const [row] = await db.execute<{
    companies_enrolled: number;
    companies_contacted: number;
    bucket_0: number;
    bucket_1: number;
    bucket_2: number;
    bucket_3plus: number;
  }>(sql`
    with company_agg as (
      select
        company_id,
        campaign_id,
        bool_or(${ENROLLED_CONTACT_SQL}) as enrolled,
        coalesce(sum(call_count) filter (where is_authority), 0) as authority_calls
      from contacts
      where company_id is not null ${campaignFilter}
      group by company_id, campaign_id
    )
    select
      count(*) filter (where enrolled) as companies_enrolled,
      count(*) filter (where enrolled and authority_calls > 0) as companies_contacted,
      count(*) filter (where enrolled and authority_calls = 0) as bucket_0,
      count(*) filter (where enrolled and authority_calls = 1) as bucket_1,
      count(*) filter (where enrolled and authority_calls = 2) as bucket_2,
      count(*) filter (where enrolled and authority_calls >= 3) as bucket_3plus
    from company_agg
  `);

  const companiesEnrolled = Number(row?.companies_enrolled ?? 0);
  const companiesContacted = Number(row?.companies_contacted ?? 0);

  return {
    companiesEnrolled,
    companiesContacted,
    contactRatePercent: companiesEnrolled > 0 ? Math.round((companiesContacted / companiesEnrolled) * 100) : 0,
    callBuckets: {
      "0": Number(row?.bucket_0 ?? 0),
      "1": Number(row?.bucket_1 ?? 0),
      "2": Number(row?.bucket_2 ?? 0),
      "3+": Number(row?.bucket_3plus ?? 0),
    },
  };
}

export type CompanyExplorerContact = {
  hubspotContactId: string;
  name: string;
  jobTitle: string | null;
  leadStatus: string | null;
  callCount: number;
  dispositionLabel: string | null;
  lastCallAt: Date | null;
  hubspotUrl: string;
};

export type CompanyExplorerRow = {
  campaignId: number;
  campaignName: string | null;
  companyId: string;
  companyName: string;
  industry: string | null;
  engagementStatus: EngagementStatus;
  contactCount: number;
  enrolled: boolean;
  authorityCallCount: number;
  sqoReached: boolean;
  sqlReached: boolean;
  authorityContacts: CompanyExplorerContact[];
  championContacts: CompanyExplorerContact[];
};

// Backs the filterable/sortable Companies Explorer table — one row per
// (campaign, company) pairing (consistent with how campaign_companies is
// keyed), each carrying its authority/champion contact lists for inline
// row expansion. Two queries merged in JS rather than one query with nested
// json_agg: simpler to get right, and this session already found a real
// drizzle-orm bug in one particular correlated-subquery shape (see the
// companiesEnrolled note in getFunnelCounts above) — scalar `(select
// exists(...))` / `(select count(...))` subqueries in a .select() list are
// the proven-safe pattern, so that's what's used here throughout.
export async function getCompaniesExplorerData(campaignId?: number): Promise<CompanyExplorerRow[]> {
  const sameCompany = sql`${contacts.companyId} = ${campaignCompanies.companyId} and ${contacts.campaignId} = ${campaignCompanies.campaignId}`;
  const sameCompanyAuthority = sql`${sameCompany} and ${contacts.isAuthority}`;

  const companyRows = await db
    .select({
      campaignId: campaignCompanies.campaignId,
      campaignName: campaigns.name,
      companyId: campaignCompanies.companyId,
      companyName: companies.name,
      industry: companies.industry,
      engagementStatus: campaignCompanies.engagementStatus,
      contactCount: sql<number>`(select count(*) from ${contacts} where ${sameCompany})`.mapWith(Number),
      enrolled: sql<boolean>`(select exists(select 1 from ${contacts} where ${sameCompany} and ${ENROLLED_CONTACT_SQL}))`,
      authorityCallCount: sql<number>`(select coalesce(sum(${contacts.callCount}), 0) from ${contacts} where ${sameCompanyAuthority})`.mapWith(
        Number,
      ),
      sqoReached: sql<boolean>`(select exists(select 1 from ${contacts} where ${sameCompany} and ${contacts.sqoReached}))`,
      sqlReached: sql<boolean>`(select exists(select 1 from ${contacts} where ${sameCompany} and ${contacts.sqlReached}))`,
    })
    .from(campaignCompanies)
    .leftJoin(companies, eq(campaignCompanies.companyId, companies.hubspotCompanyId))
    .leftJoin(campaigns, eq(campaignCompanies.campaignId, campaigns.id))
    .where(campaignId ? eq(campaignCompanies.campaignId, campaignId) : undefined)
    .orderBy(companies.name);

  const contactRows = await db
    .select({
      hubspotContactId: contacts.hubspotContactId,
      campaignId: contacts.campaignId,
      companyId: contacts.companyId,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      jobTitle: contacts.jobTitle,
      isAuthority: contacts.isAuthority,
      leadStatus: contacts.leadStatus,
      callCount: contacts.callCount,
      lastCallDispositionLabel: contacts.lastCallDispositionLabel,
      lastCallAt: contacts.lastCallAt,
    })
    .from(contacts)
    .where(
      campaignId
        ? and(eq(contacts.campaignId, campaignId), isNotNull(contacts.companyId))
        : isNotNull(contacts.companyId),
    );

  const contactsByKey = new Map<string, typeof contactRows>();
  for (const c of contactRows) {
    const key = `${c.campaignId}:${c.companyId}`;
    const list = contactsByKey.get(key);
    if (list) list.push(c);
    else contactsByKey.set(key, [c]);
  }

  const toExplorerContact = (c: (typeof contactRows)[number]): CompanyExplorerContact => ({
    hubspotContactId: c.hubspotContactId,
    name: [c.firstName, c.lastName].filter(Boolean).join(" ") || "(no name)",
    jobTitle: c.jobTitle,
    leadStatus: c.leadStatus,
    callCount: c.callCount,
    dispositionLabel: c.lastCallDispositionLabel,
    lastCallAt: c.lastCallAt,
    hubspotUrl: hubspotContactUrl(c.hubspotContactId),
  });

  return companyRows.map((row) => {
    const rowContacts = contactsByKey.get(`${row.campaignId}:${row.companyId}`) ?? [];
    return {
      ...row,
      companyName: row.companyName ?? `Unknown company (${row.companyId})`,
      authorityContacts: rowContacts.filter((c) => c.isAuthority).map(toExplorerContact),
      championContacts: rowContacts.filter((c) => !c.isAuthority).map(toExplorerContact),
    };
  });
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
      callCount: contacts.callCount,
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
      callCount: metric === "calls" ? r.callCount : null,
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

// Powers the daily bar chart inside the Calls Made / Connects drill-down
// popups. `dispositionCategory` is precomputed at sync time (see
// classifyForDailyChart in lib/sync.ts) so this is a plain grouped count, no
// string matching here. Grouped in Toronto (America/Toronto) calendar days —
// the team is in Toronto, and calledAt is stored as a bare UTC-equivalent
// timestamp (HubSpot's hs_timestamp), so bucketing by raw UTC day previously
// shifted evening calls onto the wrong day (e.g. an 8pm Toronto call is
// already past midnight UTC). `AT TIME ZONE 'UTC'` reinterprets the naive
// timestamp as the UTC instant it represents; the second `AT TIME ZONE`
// converts that instant to Toronto's wall-clock day, DST-aware.
export async function getDailyCallStats(campaignId?: number) {
  const dayExpr = sql`date_trunc('day', ${callEvents.calledAt} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Toronto')`;

  const rows = await db
    .select({
      date: sql<string>`to_char(${dayExpr}, 'YYYY-MM-DD')`,
      callsMade: sql<number>`count(*)::int`,
      connects: sql<number>`count(*) filter (where ${callEvents.dispositionCategory} = 'connected')::int`,
      // "wrong" here means Wrong Title only — Wrong Number isn't counted in
      // Connects at all (never actually reached anyone), see
      // classifyForDailyChart in lib/sync.ts.
      wrongTitle: sql<number>`count(*) filter (where ${callEvents.dispositionCategory} = 'wrong')::int`,
    })
    .from(callEvents)
    .where(
      campaignId
        ? and(eq(callEvents.campaignId, campaignId), isNotNull(callEvents.calledAt))
        : isNotNull(callEvents.calledAt),
    )
    .groupBy(dayExpr)
    .orderBy(dayExpr);

  return rows.map((r) => ({
    date: r.date,
    callsMade: Number(r.callsMade),
    connects: Number(r.connects),
    wrongTitle: Number(r.wrongTitle),
  }));
}

// Meeting-outcome / pipeline-progression view (a separate lens from the
// company-engagement view): did booked meetings actually happen, and did any
// progress to a qualified opportunity. SQO/SQL stage IDs are portal-specific,
// defined by the user — see SQO_STAGE_IDS / SALES_PIPELINE_ID in lib/sync.ts.
export async function getMeetingsPipelineStats(campaignId?: number) {
  const where = campaignId ? eq(contacts.campaignId, campaignId) : undefined;
  const [agg] = await db
    .select({
      meetingSat: sql<number>`count(*) filter (where ${contacts.lastMeetingOutcome} = 'COMPLETED')`.mapWith(
        Number,
      ),
      stillToSit: sql<number>`count(*) filter (where ${contacts.lastMeetingOutcome} = 'SCHEDULED')`.mapWith(
        Number,
      ),
      needsRebooked: sql<number>`count(*) filter (where ${contacts.lastMeetingOutcome} in ('RESCHEDULED', 'NO_SHOW', 'CANCELED'))`.mapWith(
        Number,
      ),
      sqo: sql<number>`count(*) filter (where ${contacts.sqoReached})`.mapWith(Number),
      sql: sql<number>`count(*) filter (where ${contacts.sqlReached})`.mapWith(Number),
    })
    .from(contacts)
    .where(where);

  const meetingSat = agg?.meetingSat ?? 0;
  const sqo = agg?.sqo ?? 0;

  return {
    meetingSat,
    stillToSit: agg?.stillToSit ?? 0,
    needsRebooked: agg?.needsRebooked ?? 0,
    sqo,
    sql: agg?.sql ?? 0,
    meetingSatVsSqoPercent: meetingSat > 0 ? Math.round((sqo / meetingSat) * 100) : 0,
  };
}

const MEETING_OUTCOME_LABELS: Record<string, string> = {
  SCHEDULED: "Still to Sit",
  COMPLETED: "Meeting Sat",
  RESCHEDULED: "Needs Rebooked (Rescheduled)",
  NO_SHOW: "Needs Rebooked (No Show)",
  CANCELED: "Needs Rebooked (Canceled)",
};

export async function getMeetingsList(campaignId?: number) {
  const where = campaignId
    ? and(
        eq(contacts.campaignId, campaignId),
        sql`(${contacts.meetingBooked} or ${contacts.sqoReached} or ${contacts.sqlReached})`,
      )
    : sql`(${contacts.meetingBooked} or ${contacts.sqoReached} or ${contacts.sqlReached})`;

  const rows = await db
    .select({
      hubspotContactId: contacts.hubspotContactId,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      jobTitle: contacts.jobTitle,
      companyName: companies.name,
      lastMeetingOutcome: contacts.lastMeetingOutcome,
      lastMeetingAt: contacts.lastMeetingAt,
      sqoReached: contacts.sqoReached,
      sqlReached: contacts.sqlReached,
      meetingOwnerName: meetingOwners.name,
    })
    .from(contacts)
    .leftJoin(companies, eq(contacts.companyId, companies.hubspotCompanyId))
    .leftJoin(meetingOwners, eq(contacts.meetingOwnerId, meetingOwners.hubspotOwnerId))
    .where(where)
    .orderBy(desc(contacts.lastMeetingAt));

  return rows.map((r) => ({
    hubspotContactId: r.hubspotContactId,
    name: [r.firstName, r.lastName].filter(Boolean).join(" ") || "(no name)",
    jobTitle: r.jobTitle,
    companyName: r.companyName,
    meetingOutcomeLabel: r.lastMeetingOutcome ? (MEETING_OUTCOME_LABELS[r.lastMeetingOutcome] ?? r.lastMeetingOutcome) : "No meeting",
    lastMeetingAt: r.lastMeetingAt,
    sqoReached: r.sqoReached,
    sqlReached: r.sqlReached,
    ownerName: r.meetingOwnerName ?? "Unassigned",
    hubspotUrl: hubspotContactUrl(r.hubspotContactId),
  }));
}
