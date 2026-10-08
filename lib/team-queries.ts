import { db } from "@/lib/db";
import { owners, teamMembers } from "@/lib/db/schema";
import { asc, sql } from "drizzle-orm";

// Team performance metric definitions (all attributed to the BDR, Toronto days):
// - Dials: every non-inbound call they logged.
// - Connects: any "Connected…" disposition (incl. Wrong Title — a live pickup).
// - Conversations: Pitch / Past Pitch / Meeting dispositions only.
// - Meetings booked: BDR-sourced Marketing-Pipeline deals they created, by
//   creation date. Deals whose Source Group is Marketing / Sage / Sales Team
//   are excluded entirely (inbound leads aren't BDR output). A blank Source Group
//   falls back to Source = ZoomInfo / 6Sense => BDR at sync time.
//   Held / rebook / lost / BANT are about THOSE bookings (booking-month
//   cohort), so a month's show rate is "of what was booked that month".
// - Status comes from the deal's Intro Meeting Status when set, else is
//   inferred (see lib/team-sync.ts).
// - Show rate: held / (held + needs rebook + no-show lost + cancelled lost) —
//   i.e. of meetings with a known result. A meeting rebooked and then held
//   counts as held. Scheduled / outcome-missing / no-meeting are excluded.
// - MQL: deal reached Pre-Assessment (or later) OR an Overview meeting was
//   scheduled — whichever came first.
// - SQL: SQL Accepted Date, else the day it moved to the Sales Pipeline.
// Both credited to whoever booked the deal.

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
  noMeeting: number;
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
  noMeeting: 0,
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
async function aggregate(range: { startDate: string; endDate: string }, group: string, byMonth: boolean) {
  const callBucket = byMonth ? sql`to_char(c.day, 'YYYY-MM')` : sql`'all'`;
  const dealDay = TORONTO_DAY("d.created_at");
  const dealBucket = byMonth ? sql`left(${dealDay}, 7)` : sql`'all'`;
  const mqlBucket = byMonth ? sql`to_char(d.mql_date, 'YYYY-MM')` : sql`'all'`;
  const sqlBucket = byMonth ? sql`to_char(d.sql_date, 'YYYY-MM')` : sql`'all'`;
  const { startDate, endDate } = range;

  const rows = await db.execute<Record<string, string | number>>(sql`
    with team as (select hubspot_owner_id from team_members where team_group = ${group}),
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
        count(*) as meetings_booked,
        count(*) filter (where d.bant) as bant,
        count(*) filter (where d.meeting_status = 'held') as held,
        count(*) filter (where d.meeting_status = 'needs_rebook') as needs_rebook,
        count(*) filter (where d.rebooked) as rebooked,
        count(*) filter (where d.meeting_status = 'no_show_lost') as no_show_lost,
        count(*) filter (where d.meeting_status = 'cancelled_lost') as cancelled_lost,
        count(*) filter (where d.meeting_status = 'scheduled') as scheduled,
        count(*) filter (where d.meeting_status = 'not_logged') as outcome_missing,
        count(*) filter (where d.meeting_status = 'no_meeting') as no_meeting
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
      coalesce(b.no_meeting, 0) no_meeting,
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
    noMeeting: Number(r.no_meeting),
    mqls: Number(r.mqls),
    sqls: Number(r.sqls),
  }));
}

// Per-rep leaderboard for a date range. Every member of the group gets a row
// (zeros included) so a rep with no activity is visible, not silently missing.
export async function getTeamStats(range: { startDate: string; endDate: string }, group: string) {
  const [members, rows] = await Promise.all([getTeamMembers(), aggregate(range, group, false)]);
  const byOwner = new Map(rows.map((r) => [r.ownerId, r]));
  const reps = members
    .filter((m) => m.teamGroup === group)
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
  const rows = await aggregate({ startDate: `${year}-01-01`, endDate: `${year}-12-31` }, group, true);
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { month, ...finish({ ownerId: month, name: month, role: "", ...sum(rows.filter((r) => r.bucket === month)) }) };
  });
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
};

const BOOKING_SELECT = sql.raw(`
  d.hubspot_deal_id, d.deal_name, tm.name as booked_by,
  to_char(d.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Toronto', 'YYYY-MM-DD') as booked_on,
  to_char(d.meeting_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Toronto', 'YYYY-MM-DD') as meeting_on,
  d.meeting_status, d.status_source, d.rebooked, d.bant,
  case when d.status_since is not null then extract(day from now() at time zone 'UTC' - d.status_since)::int end as days_in_status,
  d.mql_date::text as mql_date, d.sql_date::text as sql_date`);

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
  };
}

// Booked meetings behind the numbers, for the list under the table.
export async function getTeamBookings(range: { startDate: string; endDate: string }, group: string) {
  const dealDay = TORONTO_DAY("d.created_at");
  const rows = await db.execute<Record<string, unknown>>(sql`
    select ${BOOKING_SELECT}
    from team_deals d
    join team_members tm on tm.hubspot_owner_id = d.booked_by_owner_id and tm.team_group = ${group}
    where ${BDR_SOURCED} and ${dealDay} between ${range.startDate} and ${range.endDate}
    order by d.created_at desc
  `);
  return rows.map(toBooking);
}

// "Needs attention" queue — independent of the selected period: every open
// BDR booking for the group that needs someone to set Intro Meeting Status
// (meeting passed with no result, or no meeting in HubSpot at all), plus
// everything waiting on a rebook. Deals already closed in HubSpot are skipped.
export async function getNeedsAttention(group: string) {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select ${BOOKING_SELECT}
    from team_deals d
    join team_members tm on tm.hubspot_owner_id = d.booked_by_owner_id and tm.team_group = ${group}
    where ${BDR_SOURCED}
      and d.meeting_status in ('not_logged', 'no_meeting', 'needs_rebook')
      and coalesce(d.deal_stage, '') not in ('123017108', 'closedlost', 'closedwon')
    order by case d.meeting_status when 'needs_rebook' then 0 when 'not_logged' then 1 else 2 end, d.created_at
  `);
  return rows.map(toBooking);
}
