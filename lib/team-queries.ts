import { db } from "@/lib/db";
import { owners, teamMembers } from "@/lib/db/schema";
import { asc, sql } from "drizzle-orm";

// Team performance metric definitions (all attributed to the BDR, Toronto days):
// - Dials: every non-inbound call they logged.
// - Connects: any "Connected…" disposition (incl. Wrong Title — a live pickup).
// - Conversations: Pitch / Past Pitch / Meeting dispositions only.
// - Meetings booked: BDR-sourced Marketing-Pipeline deals they created that
//   have a meeting (record in HubSpot, or any Intro Meeting Status set), by
//   creation date. Activated = the BDR created the deal but there's no
//   meeting (Future Prospects) — per the user. Deals whose Source Group is Marketing / Sage / Sales Team
//   are excluded entirely (inbound leads aren't BDR output). A blank Source Group
//   falls back to Source = ZoomInfo / 6Sense => BDR at sync time.
//   Held / rebook / lost / BANT are about THOSE bookings (booking-month
//   cohort), so a month's show rate is "of what was booked that month".
// - Status comes from the deal's Intro Meeting Status when set, else is
//   inferred (see lib/team-sync.ts).
// - Show rate: held / (held + needs rebook + no-show lost + cancelled lost) —
//   i.e. of meetings with a known result. A meeting rebooked and then held
//   counts as held. Scheduled / outcome-missing / no-meeting are excluded.
// - MQL: month the deal first entered Pre-Assessment / System Overview.
// - SQL: month the deal first entered the Sales Pipeline.
// Both credited to whoever booked the deal.

// Pseudo-group: every team member, current and former — the MQL/SQL history view.
export const ALL_BDRS = "All BDRs";

function teamOwnersSql(group: string) {
  return group === ALL_BDRS
    ? sql`select hubspot_owner_id from team_members`
    : sql`select hubspot_owner_id from team_members where team_group = ${group}`;
}

export const BDR_SOURCED = sql.raw(`d.source_group = 'BDR'`);

export type TeamStatRow = {
  ownerId: string;
  name: string;
  role: string;
  dials: number;
  connects: number;
  conversations: number;
  meetingsBooked: number;
  bant: number;
  held: number;
  needsRebook: number;
  rebooked: number;
  noShowLost: number;
  cancelledLost: number;
  scheduled: number;
  outcomeMissing: number;
  activated: number;
  mqls: number;
  sqls: number;
  connectRate: number;
  showRate: number | null;
};

const TORONTO_DAY = (col: string) =>
  sql.raw(`to_char(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Toronto', 'YYYY-MM-DD')`);

const ZERO = {
  dials: 0,
  connects: 0,
  conversations: 0,
  meetingsBooked: 0,
  bant: 0,
  held: 0,
  needsRebook: 0,
  rebooked: 0,
  noShowLost: 0,
  cancelledLost: 0,
  scheduled: 0,
  outcomeMissing: 0,
  activated: 0,
  mqls: 0,
  sqls: 0,
};
type Counts = typeof ZERO;
const COUNT_KEYS = Object.keys(ZERO) as (keyof Counts)[];

function finish(r: Counts & { ownerId: string; name: string; role: string }): TeamStatRow {
  const resolved = r.held + r.needsRebook + r.noShowLost + r.cancelledLost;
  return {
    ...r,
    connectRate: r.dials > 0 ? Math.round((r.connects / r.dials) * 1000) / 10 : 0,
    showRate: resolved > 0 ? Math.round((r.held / resolved) * 100) : null,
  };
}

function sum(rows: Counts[]): Counts {
  const out = { ...ZERO };
  for (const r of rows) for (const k of COUNT_KEYS) out[k] += r[k];
  return out;
}

export async function getTeamMembers() {
  return db.select().from(teamMembers).orderBy(asc(teamMembers.teamGroup), asc(teamMembers.name));
}

export async function getTeamGroups(): Promise<string[]> {
  const rows = await db.selectDistinct({ g: teamMembers.teamGroup }).from(teamMembers).orderBy(asc(teamMembers.teamGroup));
  return rows.map((r) => r.g);
}

// HubSpot owners not yet on the team, for the Settings "add rep" picker.
export async function getOwnersNotOnTeam() {
  return db
    .select({ id: owners.hubspotOwnerId, name: owners.name, email: owners.email })
    .from(owners)
    .where(sql`${owners.hubspotOwnerId} not in (select hubspot_owner_id from team_members)`)
    .orderBy(asc(owners.name));
}

// Core aggregate: one row per (owner, bucket) for team members in `group`.
// bucket is 'all' or a YYYY-MM month, so the same query backs both the
// per-rep leaderboard and the month-by-month trend.
type Granularity = "all" | "month" | "week";

// bucket expression for a date-typed SQL expression: 'all', 'YYYY-MM', or the
// Monday of its week as 'YYYY-MM-DD'.
function bucketOf(dateExpr: ReturnType<typeof sql>, g: Granularity) {
  if (g === "month") return sql`to_char(${dateExpr}, 'YYYY-MM')`;
  if (g === "week") return sql`to_char(date_trunc('week', ${dateExpr}), 'YYYY-MM-DD')`;
  return sql`'all'`;
}

async function aggregate(range: { startDate: string; endDate: string }, group: string, granularity: Granularity) {
  const dealDay = TORONTO_DAY("d.created_at");
  const callBucket = bucketOf(sql`c.day`, granularity);
  const dealBucket = bucketOf(sql`(${dealDay})::date`, granularity);
  const mqlBucket = bucketOf(sql`d.mql_date`, granularity);
  const sqlBucket = bucketOf(sql`d.sql_date`, granularity);
  const { startDate, endDate } = range;

  const rows = await db.execute<Record<string, string | number>>(sql`
    with team as (${teamOwnersSql(group)}),
    calls as (
      select c.owner_id, ${callBucket} as bucket,
        sum(c.calls) filter (where c.direction <> 'INBOUND') as dials,
        sum(c.calls) filter (where c.direction <> 'INBOUND' and c.disposition_label like 'Connected%') as connects,
        sum(c.calls) filter (where c.direction <> 'INBOUND' and c.disposition_label in
          ('Connected - 01 - Pitch', 'Connected - 02 - Past Pitch', 'Connected - 03 - Meeting')) as conversations
      from team_call_daily c
      where c.owner_id in (select hubspot_owner_id from team)
        and c.day between ${startDate}::date and ${endDate}::date
      group by 1, 2
    ),
    booked as (
      select d.booked_by_owner_id as owner_id, ${dealBucket} as bucket,
        count(*) filter (where d.meeting_status <> 'no_meeting') as meetings_booked,
        count(*) filter (where d.bant) as bant,
        count(*) filter (where d.meeting_status = 'held') as held,
        count(*) filter (where d.meeting_status = 'needs_rebook') as needs_rebook,
        count(*) filter (where d.rebooked) as rebooked,
        count(*) filter (where d.meeting_status = 'no_show_lost') as no_show_lost,
        count(*) filter (where d.meeting_status = 'cancelled_lost') as cancelled_lost,
        count(*) filter (where d.meeting_status = 'scheduled') as scheduled,
        count(*) filter (where d.meeting_status = 'not_logged') as outcome_missing,
        count(*) filter (where d.meeting_status = 'no_meeting') as activated
      from team_deals d
      where d.booked_by_owner_id in (select hubspot_owner_id from team) and ${BDR_SOURCED}
        and ${dealDay} between ${startDate} and ${endDate}
      group by 1, 2
    ),
    mqls as (
      select d.booked_by_owner_id as owner_id, ${mqlBucket} as bucket, count(*) as mqls
      from team_deals d
      where d.booked_by_owner_id in (select hubspot_owner_id from team) and ${BDR_SOURCED}
        and d.mql_date between ${startDate}::date and ${endDate}::date
      group by 1, 2
    ),
    sqls as (
      select d.booked_by_owner_id as owner_id, ${sqlBucket} as bucket, count(*) as sqls
      from team_deals d
      where d.booked_by_owner_id in (select hubspot_owner_id from team) and ${BDR_SOURCED}
        and d.sql_date between ${startDate}::date and ${endDate}::date
      group by 1, 2
    ),
    keys as (
      select owner_id, bucket from calls union select owner_id, bucket from booked
      union select owner_id, bucket from mqls union select owner_id, bucket from sqls
    )
    select k.owner_id, k.bucket,
      coalesce(c.dials, 0) dials, coalesce(c.connects, 0) connects, coalesce(c.conversations, 0) conversations,
      coalesce(b.meetings_booked, 0) meetings_booked, coalesce(b.bant, 0) bant, coalesce(b.held, 0) held,
      coalesce(b.needs_rebook, 0) needs_rebook, coalesce(b.rebooked, 0) rebooked,
      coalesce(b.no_show_lost, 0) no_show_lost, coalesce(b.cancelled_lost, 0) cancelled_lost,
      coalesce(b.scheduled, 0) scheduled, coalesce(b.outcome_missing, 0) outcome_missing,
      coalesce(b.activated, 0) activated,
      coalesce(m.mqls, 0) mqls, coalesce(s.sqls, 0) sqls
    from keys k
    left join calls c using (owner_id, bucket)
    left join booked b using (owner_id, bucket)
    left join mqls m using (owner_id, bucket)
    left join sqls s using (owner_id, bucket)
  `);

  return rows.map((r) => ({
    ownerId: String(r.owner_id),
    bucket: String(r.bucket),
    dials: Number(r.dials),
    connects: Number(r.connects),
    conversations: Number(r.conversations),
    meetingsBooked: Number(r.meetings_booked),
    bant: Number(r.bant),
    held: Number(r.held),
    needsRebook: Number(r.needs_rebook),
    rebooked: Number(r.rebooked),
    noShowLost: Number(r.no_show_lost),
    cancelledLost: Number(r.cancelled_lost),
    scheduled: Number(r.scheduled),
    outcomeMissing: Number(r.outcome_missing),
    activated: Number(r.activated),
    mqls: Number(r.mqls),
    sqls: Number(r.sqls),
  }));
}

// Per-rep leaderboard for a date range. Every member of the group gets a row
// (zeros included) so a rep with no activity is visible, not silently missing.
export async function getTeamStats(range: { startDate: string; endDate: string }, group: string) {
  const [members, rows] = await Promise.all([getTeamMembers(), aggregate(range, group, "all")]);
  const byOwner = new Map(rows.map((r) => [r.ownerId, r]));
  const reps = members
    .filter((m) => group === ALL_BDRS || m.teamGroup === group)
    .map((m) => {
      const r = byOwner.get(m.hubspotOwnerId);
      const counts: Counts = { ...ZERO };
      if (r) for (const k of COUNT_KEYS) counts[k] = r[k];
      return finish({ ownerId: m.hubspotOwnerId, name: m.name, role: m.role, ...counts });
    });
  const total = finish({ ownerId: "total", name: "Team total", role: "", ...sum(reps) });
  return { reps, total };
}

// Month-by-month team totals for one calendar year (Jan..Dec, future months
// included as zeros so the year reads as a full grid).
export async function getTeamMonthly(year: number, group: string) {
  const rows = await aggregate({ startDate: `${year}-01-01`, endDate: `${year}-12-31` }, group, "month");
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { month, ...finish({ ownerId: month, name: month, role: "", ...sum(rows.filter((r) => r.bucket === month)) }) };
  });
}

// Week-by-week team totals for a date range (weeks start Monday; a week that
// straddles the range edge only counts the days inside the range).
export async function getTeamWeekly(range: { startDate: string; endDate: string }, group: string) {
  const rows = await aggregate(range, group, "week");
  const weeks: string[] = [];
  const start = new Date(`${range.startDate}T00:00:00Z`);
  const monday = new Date(start);
  monday.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  for (let d = monday; d.toISOString().slice(0, 10) <= range.endDate; d = new Date(d.getTime() + 7 * 86400000)) {
    weeks.push(d.toISOString().slice(0, 10));
  }
  return weeks.map((week) => ({
    week,
    ...finish({ ownerId: week, name: week, role: "", ...sum(rows.filter((r) => r.bucket === week)) }),
  }));
}

export type Booking = {
  dealId: string;
  dealName: string;
  bookedBy: string;
  bookedOn: string;
  meetingOn: string | null;
  meetingStatus: string;
  statusSource: string;
  daysInStatus: number | null;
  rebooked: boolean;
  bant: boolean;
  mqlDate: string | null;
  sqlDate: string | null;
  ownerId: string;
  segmentId: number | null;
  campaignId: number | null;
};

const BOOKING_SELECT = sql.raw(`
  d.hubspot_deal_id, d.deal_name, tm.name as booked_by,
  to_char(d.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Toronto', 'YYYY-MM-DD') as booked_on,
  to_char(d.meeting_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Toronto', 'YYYY-MM-DD') as meeting_on,
  d.meeting_status, d.status_source, d.rebooked, d.bant,
  case when d.status_since is not null then extract(day from now() at time zone 'UTC' - d.status_since)::int end as days_in_status,
  d.mql_date::text as mql_date, d.sql_date::text as sql_date,
  d.booked_by_owner_id, d.segment_id, (select s.campaign_id from segments s where s.id = d.segment_id) as campaign_id`);

function toBooking(r: Record<string, unknown>): Booking {
  return {
    dealId: String(r.hubspot_deal_id),
    dealName: (r.deal_name as string) ?? "(unnamed deal)",
    bookedBy: String(r.booked_by),
    bookedOn: String(r.booked_on),
    meetingOn: (r.meeting_on as string) ?? null,
    meetingStatus: String(r.meeting_status),
    statusSource: String(r.status_source),
    daysInStatus: r.days_in_status == null ? null : Number(r.days_in_status),
    rebooked: Boolean(r.rebooked),
    bant: Boolean(r.bant),
    mqlDate: (r.mql_date as string) ?? null,
    sqlDate: (r.sql_date as string) ?? null,
    ownerId: String(r.booked_by_owner_id),
    segmentId: r.segment_id == null ? null : Number(r.segment_id),
    campaignId: r.campaign_id == null ? null : Number(r.campaign_id),
  };
}

// Booked meetings behind the numbers, for the list under the table.
export async function getTeamBookings(range: { startDate: string; endDate: string }, group: string) {
  const dealDay = TORONTO_DAY("d.created_at");
  const rows = await db.execute<Record<string, unknown>>(sql`
    select ${BOOKING_SELECT}
    from team_deals d
    join team_members tm on tm.hubspot_owner_id = d.booked_by_owner_id
      and (${group} = ${ALL_BDRS} or tm.team_group = ${group})
    where ${BDR_SOURCED} and ${dealDay} between ${range.startDate} and ${range.endDate}
    order by d.created_at desc
  `);
  return rows.map(toBooking);
}

// "Needs attention" queue — independent of the selected period: every open
// BDR booking for the group whose meeting passed with no Intro Meeting Status,
// plus everything waiting on a rebook. (Deals with no meeting at all are
// activated leads, not problems — unless a meeting was deleted, in which case
// setting Intro Meeting Status turns it back into a meeting.) Deals already closed in HubSpot are skipped.
export async function getNeedsAttention(group: string) {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select ${BOOKING_SELECT}
    from team_deals d
    join team_members tm on tm.hubspot_owner_id = d.booked_by_owner_id
      and (${group} = ${ALL_BDRS} or tm.team_group = ${group})
    where ${BDR_SOURCED}
      and d.meeting_status in ('not_logged', 'needs_rebook')
      and coalesce(d.deal_stage, '') not in ('123017108', 'closedlost', 'closedwon')
      -- only recent bookings: a meeting months old with no outcome is history,
      -- not an action item (keeps the queue short and actionable)
      and d.created_at >= now() - interval '90 days'
    order by case d.meeting_status when 'needs_rebook' then 0 when 'not_logged' then 1 else 2 end, d.created_at
  `);
  return rows.map(toBooking);
}

// --- Segments & campaigns ---------------------------------------------------------
// Unlike the monthly view, segment numbers use each segment's OWN start/end
// window (what the BDR registered); the selected period only decides which
// segments are listed (those whose window overlaps it).

export type SegmentStatRow = {
  segmentId: number;
  campaignId: number;
  campaignName: string;
  listName: string;
  hubspotListId: string;
  rep: string;
  ownerId: string;
  startDate: string;
  endDate: string | null;
  leads: number;
  contacted: number;
  dials: number;
  connected: number;
  conversations: number;
  notInterested: number;
  unqualified: number;
  activated: number;
  meetings: number;
  bant: number;
  held: number;
  needsRebook: number;
  noShowLost: number;
  cancelledLost: number;
  mqls: number;
  sqls: number;
  showRate: number | null;
};

const SEG_COUNT_KEYS = [
  "leads",
  "contacted",
  "dials",
  "connected",
  "conversations",
  "notInterested",
  "unqualified",
  "activated",
  "meetings",
  "bant",
  "held",
  "needsRebook",
  "noShowLost",
  "cancelledLost",
  "mqls",
  "sqls",
] as const;

function segShowRate(r: { held: number; needsRebook: number; noShowLost: number; cancelledLost: number }) {
  const resolved = r.held + r.needsRebook + r.noShowLost + r.cancelledLost;
  return resolved > 0 ? Math.round((r.held / resolved) * 100) : null;
}

// accounts=true counts distinct companies instead of people for the lead
// columns (an account is "contacted" if anyone there was called, etc.).
export async function getSegmentStats(
  range: { startDate: string; endDate: string },
  group: string,
  accounts: boolean,
): Promise<SegmentStatRow[]> {
  const n = (cond: string) =>
    sql.raw(accounts ? `count(distinct l.company_id) filter (where ${cond})` : `count(*) filter (where ${cond})`);
  const rows = await db.execute<Record<string, unknown>>(sql`
    with leads as (
      select l.segment_id,
        ${n("true")} as leads,
        ${n("l.calls > 0")} as contacted,
        sum(l.calls) as dials,
        ${n("l.connected")} as connected,
        ${n("l.conversation")} as conversations,
        ${n("l.lead_status = 'Not Interested'")} as not_interested,
        ${n("l.lead_status = 'Unqualified'")} as unqualified
      from segment_leads l group by 1
    ),
    deals as (
      select d.segment_id,
        count(*) filter (where d.meeting_status = 'no_meeting') as activated,
        count(*) filter (where d.meeting_status <> 'no_meeting') as meetings,
        count(*) filter (where d.bant) as bant,
        count(*) filter (where d.meeting_status = 'held') as held,
        count(*) filter (where d.meeting_status = 'needs_rebook') as needs_rebook,
        count(*) filter (where d.meeting_status = 'no_show_lost') as no_show_lost,
        count(*) filter (where d.meeting_status = 'cancelled_lost') as cancelled_lost,
        count(d.mql_date) as mqls,
        count(d.sql_date) as sqls
      from team_deals d where d.segment_id is not null and ${BDR_SOURCED} group by 1
    )
    select s.id, s.campaign_id, c.name as campaign_name, s.list_name, s.hubspot_list_id, s.owner_id,
      coalesce(tm.name, s.owner_id) as rep, s.start_date::text as start_date, s.end_date::text as end_date,
      coalesce(l.leads, 0) leads, coalesce(l.contacted, 0) contacted, coalesce(l.dials, 0) dials,
      coalesce(l.connected, 0) connected, coalesce(l.conversations, 0) conversations,
      coalesce(l.not_interested, 0) not_interested, coalesce(l.unqualified, 0) unqualified,
      coalesce(d.activated, 0) activated, coalesce(d.meetings, 0) meetings, coalesce(d.bant, 0) bant,
      coalesce(d.held, 0) held, coalesce(d.needs_rebook, 0) needs_rebook, coalesce(d.no_show_lost, 0) no_show_lost,
      coalesce(d.cancelled_lost, 0) cancelled_lost, coalesce(d.mqls, 0) mqls, coalesce(d.sqls, 0) sqls
    from segments s
    join bdr_campaigns c on c.id = s.campaign_id and not c.archived
    left join team_members tm on tm.hubspot_owner_id = s.owner_id
    left join leads l on l.segment_id = s.id
    left join deals d on d.segment_id = s.id
    where s.owner_id in (${teamOwnersSql(group)})
      and s.start_date <= ${range.endDate}::date
      and coalesce(s.end_date, current_date) >= ${range.startDate}::date
    order by c.name, s.start_date, s.list_name
  `);
  return rows.map((r) => {
    const row = {
      segmentId: Number(r.id),
      campaignId: Number(r.campaign_id),
      campaignName: String(r.campaign_name),
      listName: String(r.list_name),
      hubspotListId: String(r.hubspot_list_id),
      rep: String(r.rep),
      ownerId: String(r.owner_id),
      startDate: String(r.start_date),
      endDate: (r.end_date as string) ?? null,
      leads: Number(r.leads),
      contacted: Number(r.contacted),
      dials: Number(r.dials),
      connected: Number(r.connected),
      conversations: Number(r.conversations),
      notInterested: Number(r.not_interested),
      unqualified: Number(r.unqualified),
      activated: Number(r.activated),
      meetings: Number(r.meetings),
      bant: Number(r.bant),
      held: Number(r.held),
      needsRebook: Number(r.needs_rebook),
      noShowLost: Number(r.no_show_lost),
      cancelledLost: Number(r.cancelled_lost),
      mqls: Number(r.mqls),
      sqls: Number(r.sqls),
    };
    return { ...row, showRate: segShowRate(row) };
  });
}

// Campaign totals = sum of its listed segments.
export function rollUpByCampaign(rows: SegmentStatRow[]): SegmentStatRow[] {
  const byCampaign = new Map<number, SegmentStatRow>();
  for (const r of rows) {
    const cur = byCampaign.get(r.campaignId);
    if (!cur) {
      byCampaign.set(r.campaignId, {
        ...r,
        listName: "",
        rep: "",
        segmentId: 0,
      });
      continue;
    }
    for (const k of SEG_COUNT_KEYS) cur[k] += r[k];
    if (r.startDate < cur.startDate) cur.startDate = r.startDate;
    cur.endDate = cur.endDate == null || r.endDate == null ? null : r.endDate > cur.endDate ? r.endDate : cur.endDate;
  }
  return [...byCampaign.values()].map((r) => ({ ...r, showRate: segShowRate(r) }));
}

export function sumSegments(rows: SegmentStatRow[]): Record<(typeof SEG_COUNT_KEYS)[number], number> {
  const out = Object.fromEntries(SEG_COUNT_KEYS.map((k) => [k, 0])) as Record<(typeof SEG_COUNT_KEYS)[number], number>;
  for (const r of rows) for (const k of SEG_COUNT_KEYS) out[k] += r[k];
  return out;
}

// Bookings in the period that aren't credited to any registered segment.
export async function getOutsideSegmentDeals(range: { startDate: string; endDate: string }, group: string) {
  const dealDay = TORONTO_DAY("d.created_at");
  const [row] = await db.execute<{ meetings: number; activated: number }>(sql`
    select count(*) filter (where d.meeting_status <> 'no_meeting')::int as meetings,
           count(*) filter (where d.meeting_status = 'no_meeting')::int as activated
    from team_deals d
    where d.segment_id is null and ${BDR_SOURCED}
      and d.booked_by_owner_id in (${teamOwnersSql(group)})
      and ${dealDay} between ${range.startDate} and ${range.endDate}
  `);
  return { meetings: Number(row?.meetings ?? 0), activated: Number(row?.activated ?? 0) };
}

// Every BDR deal credited to the given segments (any booking date) — the
// drill-down list for the campaign/segment views, whose numbers use each
// segment's own window rather than the selected period.
export async function getBookingsForSegments(segmentIds: number[]) {
  if (segmentIds.length === 0) return [];
  const rows = await db.execute<Record<string, unknown>>(sql`
    select ${BOOKING_SELECT}
    from team_deals d
    left join team_members tm on tm.hubspot_owner_id = d.booked_by_owner_id
    where ${BDR_SOURCED} and d.segment_id in (${sql.join(segmentIds.map((id) => sql`${id}`), sql`, `)})
    order by d.created_at desc
  `);
  return rows.map(toBooking);
}
