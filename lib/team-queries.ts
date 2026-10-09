import { db } from "@/lib/db";
import { owners, teamMembers } from "@/lib/db/schema";
import { asc, sql, type SQL } from "drizzle-orm";

// Team performance metric definitions (all attributed to the BDR who booked
// the deal, Toronto days). Two ways to count, per the user:
//
// "activity" (default, "when it happened") — every number lands in the
//   period the event happened:
//   - Meetings (set): BDR-sourced Marketing-Pipeline deals created in the
//     period that have a meeting. Activated = a contact set to Lead Status
//     "Open Deal" in the period with no deal yet (lib/activated.ts).
//   - Sat: intro meetings that took place in the period and were held
//     (notetaker recording or outcome Completed), whenever they were booked.
//   - Show rate: of the intro meetings that took place in the period,
//     sat / (sat + no-show + canceled). A no-show later switched to
//     Rescheduled still counts as a no-show; a meeting moved before it
//     happened (only ever Rescheduled) doesn't count either way.
//   - BANT: the BANT box ticked in the period. MQL / SQL: entered the stage
//     in the period (Pre-Assessment / System Overview; Sales Pipeline).
// "cohort" ("when it was booked") — everything is about the deals booked in
//   the period, however long the outcome took: of those bookings, how many
//   sat, became BANT / MQL / SQL, and the show rate of their intro meetings.
//
// Dials / connects / conversations are always by call date.
// Deals whose Source Group is Marketing / Sage / Sales Team are excluded
// entirely (inbound leads aren't BDR output); blank Source Group falls back to
// Source = ZoomInfo / 6Sense => BDR at sync time. Meeting results come from
// the HubSpot meeting records — see lib/team-sync.ts.

// Pseudo-group: every team member, current and former — the MQL/SQL history view.
export const ALL_BDRS = "All BDRs";

// Who the numbers cover: a team group (or All BDRs), optionally narrowed to one rep.
export type TeamFilter = { group: string; ownerId?: string };
export type DateRange = { startDate: string; endDate: string };
export type CountMode = "activity" | "cohort";

function teamOwnersSql(f: TeamFilter) {
  const groupCond = f.group === ALL_BDRS ? sql`true` : sql`team_group = ${f.group}`;
  const ownerCond = f.ownerId ? sql`hubspot_owner_id = ${f.ownerId}` : sql`true`;
  return sql`select hubspot_owner_id from team_members where ${groupCond} and ${ownerCond}`;
}

export const BDR_SOURCED = sql.raw(`d.source_group = 'BDR'`);

const TORONTO_DAY = (col: string) =>
  sql.raw(`to_char(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Toronto', 'YYYY-MM-DD')`);

// --- Shared deal/meeting metrics ------------------------------------------------

const DEAL_ZERO = {
  meetingsBooked: 0,
  activated: 0,
  sat: 0,
  noShows: 0,
  cancels: 0,
  // what became of this period's no-shows / cancels (by the deal's state now)
  missRebook: 0,
  missRebooked: 0,
  missLost: 0,
  outcomeMissing: 0,
  scheduled: 0,
  bant: 0,
  mqls: 0,
  sqls: 0,
};
type DealCounts = typeof DEAL_ZERO;
const DEAL_KEYS = Object.keys(DEAL_ZERO) as (keyof DealCounts)[];

const ZERO = { dials: 0, connects: 0, conversations: 0, ...DEAL_ZERO };
type Counts = typeof ZERO;
const COUNT_KEYS = Object.keys(ZERO) as (keyof Counts)[];

export type TeamStatRow = Counts & {
  ownerId: string;
  name: string;
  role: string;
  connectRate: number;
  showRate: number | null;
};

export function showRateOf(r: { sat: number; noShows: number; cancels: number }) {
  const resolved = r.sat + r.noShows + r.cancels;
  return resolved > 0 ? Math.round((r.sat / resolved) * 100) : null;
}

function finish(r: Counts & { ownerId: string; name: string; role: string }): TeamStatRow {
  return {
    ...r,
    connectRate: r.dials > 0 ? Math.round((r.connects / r.dials) * 1000) / 10 : 0,
    showRate: showRateOf(r),
  };
}

function sum(rows: Counts[]): Counts {
  const out = { ...ZERO };
  for (const r of rows) for (const k of COUNT_KEYS) out[k] += r[k];
  return out;
}

type Granularity = "all" | "month" | "week";

// bucket expression for a date-typed SQL expression: 'all', 'YYYY-MM', or the
// Monday of its week as 'YYYY-MM-DD'.
function bucketOf(dateExpr: SQL, g: Granularity) {
  if (g === "month") return sql`to_char(${dateExpr}, 'YYYY-MM')`;
  if (g === "week") return sql`to_char(date_trunc('week', ${dateExpr}), 'YYYY-MM-DD')`;
  return sql`'all'`;
}

function dayLiteral(day: string): SQL {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`bad day: ${day}`);
  return sql.raw(`'${day}'`);
}

// Deal + intro-meeting metrics per (key, bucket). `key` is an expression over
// team_deals d (rep, segment, …); `where` limits the deals.
async function dealMetrics(
  key: SQL,
  where: SQL,
  range: DateRange,
  mode: CountMode,
  g: Granularity,
): Promise<(DealCounts & { k: string; bucket: string })[]> {
  // Dates go in as literals (validated YYYY-MM-DD): repeated as ~15 bind
  // parameters, this query wedged Supabase's pooler under concurrent load
  // (backends stuck in ClientRead) — reproduced at 30 parallel calls.
  const s = dayLiteral(range.startDate);
  const e = dayLiteral(range.endDate);
  const dealDay = TORONTO_DAY("d.created_at");
  const meetDay = TORONTO_DAY("m.meeting_at");
  const actDay = TORONTO_DAY("d.activated_at");
  const bookedIn = sql`${dealDay} between ${s} and ${e}`;
  const dealBucket = bucketOf(sql`(${dealDay})::date`, g);
  const cohort = mode === "cohort";
  const attBucket = cohort ? dealBucket : bucketOf(sql`(${meetDay})::date`, g);
  const attIn = cohort ? bookedIn : sql`${meetDay} between ${s} and ${e}`;
  const dated = (col: string) => sql`
    select ${key} as k, ${bucketOf(sql.raw(col), g)} as bucket, count(*) as n
    from team_deals d
    where ${where} and ${BDR_SOURCED} and ${sql.raw(col)} between ${s}::date and ${e}::date
    group by 1, 2`;
  const rows = await db.execute<Record<string, string | number>>(sql`
    with booked as (
      select ${key} as k, ${dealBucket} as bucket,
        count(*) filter (where d.meeting_status <> 'no_meeting') as meetings,
        count(*) filter (where d.bant) as c_bant,
        count(d.mql_date) as c_mqls,
        count(d.sql_date) as c_sqls
      from team_deals d
      where ${where} and ${BDR_SOURCED} and ${bookedIn}
      group by 1, 2
    ),
    att as (
      select ${key} as k, ${attBucket} as bucket,
        count(*) filter (where m.result = 'sat') as sat,
        count(*) filter (where m.result = 'no_show') as no_shows,
        count(*) filter (where m.result = 'canceled') as cancels,
        count(*) filter (where m.result in ('no_show', 'canceled') and not m.rebooked
          and d.meeting_status = 'needs_rebook') as miss_rebook,
        count(*) filter (where m.result in ('no_show', 'canceled') and not m.rebooked
          and d.meeting_status in ('no_show_lost', 'cancelled_lost')) as miss_lost,
        count(*) filter (where m.result in ('no_show', 'canceled') and (m.rebooked
          or d.meeting_status not in ('needs_rebook', 'no_show_lost', 'cancelled_lost'))) as miss_rebooked,
        count(*) filter (where m.result = 'not_logged') as outcome_missing,
        count(*) filter (where m.result = 'scheduled') as scheduled
      from team_intro_meetings m
      join team_deals d on d.hubspot_deal_id = m.deal_id
      where ${where} and ${BDR_SOURCED} and ${attIn}
      group by 1, 2
    ),
    -- activated_leads shaped like team_deals so the same key / where apply
    act as (
      select ${key} as k, ${bucketOf(sql`(${actDay})::date`, g)} as bucket, count(*) as n
      from (select owner_id as booked_by_owner_id, segment_id, activated_at from activated_leads) d
      where ${where} and ${actDay} between ${s} and ${e}
      group by 1, 2
    ),
    bant as (${dated("d.bant_date")}),
    mqls as (${dated("d.mql_date")}),
    sqls as (${dated("d.sql_date")}),
    keys as (
      select k, bucket from booked union select k, bucket from att union select k, bucket from act
      union select k, bucket from bant union select k, bucket from mqls union select k, bucket from sqls
    )
    select keys.k, keys.bucket,
      coalesce(b.meetings, 0) meetings, coalesce(ac.n, 0) activated,
      coalesce(a.sat, 0) sat, coalesce(a.no_shows, 0) no_shows, coalesce(a.cancels, 0) cancels,
      coalesce(a.miss_rebook, 0) miss_rebook, coalesce(a.miss_rebooked, 0) miss_rebooked, coalesce(a.miss_lost, 0) miss_lost,
      coalesce(a.outcome_missing, 0) outcome_missing, coalesce(a.scheduled, 0) scheduled,
      ${cohort ? sql`coalesce(b.c_bant, 0)` : sql`coalesce(bt.n, 0)`} bant,
      ${cohort ? sql`coalesce(b.c_mqls, 0)` : sql`coalesce(mq.n, 0)`} mqls,
      ${cohort ? sql`coalesce(b.c_sqls, 0)` : sql`coalesce(sq.n, 0)`} sqls
    from keys
    left join booked b on b.k is not distinct from keys.k and b.bucket = keys.bucket
    left join att a on a.k is not distinct from keys.k and a.bucket = keys.bucket
    left join act ac on ac.k is not distinct from keys.k and ac.bucket = keys.bucket
    left join bant bt on bt.k is not distinct from keys.k and bt.bucket = keys.bucket
    left join mqls mq on mq.k is not distinct from keys.k and mq.bucket = keys.bucket
    left join sqls sq on sq.k is not distinct from keys.k and sq.bucket = keys.bucket
  `);
  return rows.map((r) => ({
    k: String(r.k),
    bucket: String(r.bucket),
    meetingsBooked: Number(r.meetings),
    activated: Number(r.activated),
    sat: Number(r.sat),
    noShows: Number(r.no_shows),
    cancels: Number(r.cancels),
    missRebook: Number(r.miss_rebook),
    missRebooked: Number(r.miss_rebooked),
    missLost: Number(r.miss_lost),
    outcomeMissing: Number(r.outcome_missing),
    scheduled: Number(r.scheduled),
    bant: Number(r.bant),
    mqls: Number(r.mqls),
    sqls: Number(r.sqls),
  }));
}

// --- Team members ---------------------------------------------------------------

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

// --- Rep / time aggregates ---------------------------------------------------------

// One row per (owner, bucket) for the filtered team: calls + deal metrics.
async function aggregate(range: DateRange, f: TeamFilter, mode: CountMode, g: Granularity) {
  const callBucket = bucketOf(sql`c.day`, g);
  const [callRows, dealRows] = await Promise.all([
    db.execute<Record<string, string | number>>(sql`
      select c.owner_id, ${callBucket} as bucket,
        sum(c.calls) filter (where c.direction <> 'INBOUND') as dials,
        sum(c.calls) filter (where c.direction <> 'INBOUND' and c.disposition_label like 'Connected%') as connects,
        sum(c.calls) filter (where c.direction <> 'INBOUND' and c.disposition_label in
          ('Connected - 01 - Pitch', 'Connected - 02 - Past Pitch', 'Connected - 03 - Meeting')) as conversations
      from team_call_daily c
      where c.owner_id in (${teamOwnersSql(f)})
        and c.day between ${range.startDate}::date and ${range.endDate}::date
      group by 1, 2
    `),
    dealMetrics(sql`d.booked_by_owner_id`, sql`d.booked_by_owner_id in (${teamOwnersSql(f)})`, range, mode, g),
  ]);
  const out = new Map<string, Counts & { ownerId: string; bucket: string }>();
  const at = (ownerId: string, bucket: string) => {
    const id = `${ownerId}|${bucket}`;
    let row = out.get(id);
    if (!row) out.set(id, (row = { ownerId, bucket, ...ZERO }));
    return row;
  };
  for (const c of callRows) {
    const row = at(String(c.owner_id), String(c.bucket));
    row.dials = Number(c.dials ?? 0);
    row.connects = Number(c.connects ?? 0);
    row.conversations = Number(c.conversations ?? 0);
  }
  for (const d of dealRows) {
    const row = at(d.k, d.bucket);
    for (const k of DEAL_KEYS) row[k] = d[k];
  }
  return [...out.values()];
}

// Per-rep leaderboard for a date range. Every member of the group gets a row
// (zeros included) so a rep with no activity is visible, not silently missing.
export async function getTeamStats(range: DateRange, f: TeamFilter, mode: CountMode = "activity") {
  const [members, rows] = await Promise.all([getTeamMembers(), aggregate(range, f, mode, "all")]);
  const byOwner = new Map(rows.map((r) => [r.ownerId, r]));
  const reps = members
    .filter((m) => (f.group === ALL_BDRS || m.teamGroup === f.group) && (!f.ownerId || m.hubspotOwnerId === f.ownerId))
    .map((m) => {
      const r = byOwner.get(m.hubspotOwnerId);
      const counts: Counts = { ...ZERO };
      if (r) for (const k of COUNT_KEYS) counts[k] = r[k];
      return finish({ ownerId: m.hubspotOwnerId, name: m.name, role: m.role, ...counts });
    });
  const total = finish({ ownerId: "total", name: "Team total", role: "", ...sum(reps) });
  return { reps, total };
}

// Month-by-month totals for every month the range touches (months with no
// activity included as zeros so the grid reads complete).
export async function getTeamMonthly(range: DateRange, f: TeamFilter, mode: CountMode = "activity") {
  const rows = await aggregate(range, f, mode, "month");
  const months: string[] = [];
  for (let m = range.startDate.slice(0, 7); m <= range.endDate.slice(0, 7); ) {
    months.push(m);
    const [y, mo] = m.split("-").map(Number);
    m = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7);
  }
  return months.map((month) => ({
    month,
    ...finish({ ownerId: month, name: month, role: "", ...sum(rows.filter((r) => r.bucket === month)) }),
  }));
}

// Week-by-week team totals for a date range (weeks start Monday; a week that
// straddles the range edge only counts the days inside the range).
export async function getTeamWeekly(range: DateRange, f: TeamFilter, mode: CountMode = "activity") {
  const rows = await aggregate(range, f, mode, "week");
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

// --- Drill-down lists ----------------------------------------------------------------

export type Booking = {
  dealId: string;
  dealName: string;
  bookedBy: string;
  bookedOn: string;
  meetingOn: string | null;
  meetingStatus: string;
  statusSource: string;
  checkFlag: string | null;
  summary: string | null;
  recordingMinutes: number | null;
  daysInStatus: number | null;
  rebooked: boolean;
  bant: boolean;
  bantDate: string | null;
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
  d.meeting_status, d.status_source, d.check_flag, d.meeting_summary, d.recording_minutes, d.rebooked, d.bant,
  d.bant_date::text as bant_date,
  case when d.status_since is not null then extract(day from now() at time zone 'UTC' - d.status_since)::int end as days_in_status,
  d.mql_date::text as mql_date, d.sql_date::text as sql_date,
  d.booked_by_owner_id, d.segment_id, (select s.campaign_id from segments s where s.id = d.segment_id) as campaign_id`);

// HubSpot's AI summary is HTML; the page shows it as plain text (never as
// HTML) so nothing from HubSpot can inject markup.
function summaryText(html: string): string {
  return html
    .replace(/<\/(p|h\d|li|div)>|<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function toBooking(r: Record<string, unknown>): Booking {
  return {
    dealId: String(r.hubspot_deal_id),
    dealName: (r.deal_name as string) ?? "(unnamed deal)",
    bookedBy: String(r.booked_by),
    bookedOn: String(r.booked_on),
    meetingOn: (r.meeting_on as string) ?? null,
    meetingStatus: String(r.meeting_status),
    statusSource: String(r.status_source),
    checkFlag: (r.check_flag as string) ?? null,
    summary: r.meeting_summary ? summaryText(String(r.meeting_summary)) : null,
    recordingMinutes: r.recording_minutes == null ? null : Number(r.recording_minutes),
    daysInStatus: r.days_in_status == null ? null : Number(r.days_in_status),
    rebooked: Boolean(r.rebooked),
    bant: Boolean(r.bant),
    bantDate: (r.bant_date as string) ?? null,
    mqlDate: (r.mql_date as string) ?? null,
    sqlDate: (r.sql_date as string) ?? null,
    ownerId: String(r.booked_by_owner_id),
    segmentId: r.segment_id == null ? null : Number(r.segment_id),
    campaignId: r.campaign_id == null ? null : Number(r.campaign_id),
  };
}

// Which deals sit behind the period's numbers: in cohort mode the deals booked
// in it; in activity mode also every deal with an intro meeting, BANT tick or
// MQL/SQL inside it.
function inPeriodSql(range: DateRange, mode: CountMode) {
  const { startDate: s, endDate: e } = range;
  const booked = sql`${TORONTO_DAY("d.created_at")} between ${s} and ${e}`;
  if (mode === "cohort") return booked;
  return sql`(${booked}
    or d.bant_date between ${s}::date and ${e}::date
    or d.mql_date between ${s}::date and ${e}::date
    or d.sql_date between ${s}::date and ${e}::date
    or exists (select 1 from team_intro_meetings m where m.deal_id = d.hubspot_deal_id
      and ${TORONTO_DAY("m.meeting_at")} between ${s} and ${e}))`;
}

export async function getTeamBookings(range: DateRange, f: TeamFilter, mode: CountMode = "activity") {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select ${BOOKING_SELECT}
    from team_deals d
    join team_members tm on tm.hubspot_owner_id = d.booked_by_owner_id
    where ${BDR_SOURCED} and d.booked_by_owner_id in (${teamOwnersSql(f)}) and ${inPeriodSql(range, mode)}
    order by d.created_at desc
  `);
  return rows.map(toBooking);
}

export async function getBookingsForSegments(segmentIds: number[], range: DateRange, mode: CountMode = "activity") {
  if (segmentIds.length === 0) return [];
  const rows = await db.execute<Record<string, unknown>>(sql`
    select ${BOOKING_SELECT}
    from team_deals d
    left join team_members tm on tm.hubspot_owner_id = d.booked_by_owner_id
    where ${BDR_SOURCED} and d.segment_id in (${sql.join(segmentIds.map((id) => sql`${id}`), sql`, `)})
      and ${inPeriodSql(range, mode)}
    order by d.created_at desc
  `);
  return rows.map(toBooking);
}

// Intro meetings behind "Sat" and show rate — one row per meeting attempt.
export type IntroAttempt = {
  dealId: string;
  dealName: string;
  bookedBy: string;
  bookedOn: string;
  meetingOn: string;
  result: string;
  rebooked: boolean;
  dealStatus: string;
  ownerId: string;
  segmentId: number | null;
};

export async function getIntroAttempts(
  range: DateRange,
  scope: { f: TeamFilter } | { segmentIds: number[] },
  mode: CountMode = "activity",
): Promise<IntroAttempt[]> {
  if ("segmentIds" in scope && scope.segmentIds.length === 0) return [];
  const who =
    "f" in scope
      ? sql`d.booked_by_owner_id in (${teamOwnersSql(scope.f)})`
      : sql`d.segment_id in (${sql.join(scope.segmentIds.map((id) => sql`${id}`), sql`, `)})`;
  const day = mode === "cohort" ? TORONTO_DAY("d.created_at") : TORONTO_DAY("m.meeting_at");
  const rows = await db.execute<Record<string, unknown>>(sql`
    select d.hubspot_deal_id, d.deal_name, coalesce(tm.name, d.booked_by_owner_id) as booked_by,
      ${TORONTO_DAY("d.created_at")} as booked_on, ${TORONTO_DAY("m.meeting_at")} as meeting_on,
      m.result, m.rebooked, d.meeting_status, d.booked_by_owner_id, d.segment_id
    from team_intro_meetings m
    join team_deals d on d.hubspot_deal_id = m.deal_id
    left join team_members tm on tm.hubspot_owner_id = d.booked_by_owner_id
    where ${BDR_SOURCED} and ${who} and ${day} between ${range.startDate} and ${range.endDate}
    order by m.meeting_at desc
  `);
  return rows.map((r) => ({
    dealId: String(r.hubspot_deal_id),
    dealName: (r.deal_name as string) ?? "(unnamed deal)",
    bookedBy: String(r.booked_by),
    bookedOn: String(r.booked_on),
    meetingOn: String(r.meeting_on),
    result: String(r.result),
    rebooked: Boolean(r.rebooked),
    dealStatus: String(r.meeting_status),
    ownerId: String(r.booked_by_owner_id),
    segmentId: r.segment_id == null ? null : Number(r.segment_id),
  }));
}

// "Needs attention" queue — independent of the selected period: every open
// BDR booking for the group whose meeting passed with no outcome and no
// recording, everything waiting on a rebook, and anything the held/no-show
// check flagged. Deals already closed in HubSpot are skipped.
export async function getNeedsAttention(f: TeamFilter) {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select ${BOOKING_SELECT}
    from team_deals d
    join team_members tm on tm.hubspot_owner_id = d.booked_by_owner_id
    where ${BDR_SOURCED} and d.booked_by_owner_id in (${teamOwnersSql(f)})
      and (d.meeting_status in ('not_logged', 'needs_rebook') or d.check_flag is not null)
      and coalesce(d.deal_stage, '') not in ('123017108', 'closedlost', 'closedwon')
      -- only recent bookings: a meeting months old with no outcome is history,
      -- not an action item (keeps the queue short and actionable)
      and d.created_at >= now() - interval '90 days'
    order by case d.meeting_status when 'needs_rebook' then 0 when 'not_logged' then 1 else 2 end, d.created_at
  `);
  return rows.map(toBooking);
}

// --- Segments & campaigns ---------------------------------------------------------
// Segment numbers use the same counting mode as everything else: calls on
// days inside the period (segment_lead_days, already limited to the segment's
// own window by the sync) plus the deal metrics above for deals credited to
// the segment. Leads / not interested / unqualified are the list as it stands
// now. Segments listed = those whose window overlaps the period.

export type SegmentStatRow = DealCounts & {
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
  ...DEAL_KEYS,
] as const;
type SegCountKey = (typeof SEG_COUNT_KEYS)[number];

// accounts=true counts distinct companies instead of people for the lead
// columns (an account is "contacted" if anyone there was called, etc.).
export async function getSegmentStats(
  range: DateRange,
  f: TeamFilter,
  accounts: boolean,
  campaignId?: number,
  mode: CountMode = "activity",
): Promise<SegmentStatRow[]> {
  const n = (cond: string) =>
    sql.raw(accounts ? `count(distinct l.company_id) filter (where ${cond})` : `count(*) filter (where ${cond})`);
  const { startDate, endDate } = range;
  const [rows, dealRows] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      with days as (
        select segment_id, contact_id, sum(calls) as calls, bool_or(connected) as connected, bool_or(conversation) as conversation
        from segment_lead_days where day between ${startDate}::date and ${endDate}::date
        group by 1, 2
      ),
      leads as (
        select l.segment_id,
          ${n("true")} as leads,
          ${n("x.calls > 0")} as contacted,
          coalesce(sum(x.calls), 0) as dials,
          ${n("x.connected")} as connected,
          ${n("x.conversation")} as conversations,
          ${n("l.lead_status = 'Not Interested'")} as not_interested,
          ${n("l.lead_status = 'Unqualified'")} as unqualified
        from segment_leads l
        left join days x on x.segment_id = l.segment_id and x.contact_id = l.contact_id
        group by 1
      )
      select s.id, s.campaign_id, c.name as campaign_name, s.list_name, s.hubspot_list_id, s.owner_id,
        coalesce(tm.name, s.owner_id) as rep, s.start_date::text as start_date, s.end_date::text as end_date,
        coalesce(l.leads, 0) leads, coalesce(l.contacted, 0) contacted, coalesce(l.dials, 0) dials,
        coalesce(l.connected, 0) connected, coalesce(l.conversations, 0) conversations,
        coalesce(l.not_interested, 0) not_interested, coalesce(l.unqualified, 0) unqualified
      from segments s
      join bdr_campaigns c on c.id = s.campaign_id and not c.archived
      left join team_members tm on tm.hubspot_owner_id = s.owner_id
      left join leads l on l.segment_id = s.id
      where s.owner_id in (${teamOwnersSql(f)})
        and (${campaignId ?? null}::int is null or s.campaign_id = ${campaignId ?? null}::int)
        and s.start_date <= ${endDate}::date
        and coalesce(s.end_date, current_date) >= ${startDate}::date
      order by c.name, s.start_date, s.list_name
    `),
    dealMetrics(sql`d.segment_id::text`, sql`d.segment_id is not null`, range, mode, "all"),
  ]);
  const bySeg = new Map(dealRows.map((d) => [d.k, d]));
  return rows.map((r) => {
    const d = bySeg.get(String(r.id));
    const deal = { ...DEAL_ZERO };
    if (d) for (const k of DEAL_KEYS) deal[k] = d[k];
    return {
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
      ...deal,
      showRate: showRateOf(deal),
    };
  });
}

// Campaign totals = sum of its listed segments.
export function rollUpByCampaign(rows: SegmentStatRow[]): SegmentStatRow[] {
  const byCampaign = new Map<number, SegmentStatRow>();
  for (const r of rows) {
    const cur = byCampaign.get(r.campaignId);
    if (!cur) {
      byCampaign.set(r.campaignId, { ...r, listName: "", rep: "", segmentId: 0 });
      continue;
    }
    for (const k of SEG_COUNT_KEYS) cur[k] += r[k];
    if (r.startDate < cur.startDate) cur.startDate = r.startDate;
    cur.endDate = cur.endDate == null || r.endDate == null ? null : r.endDate > cur.endDate ? r.endDate : cur.endDate;
  }
  return [...byCampaign.values()].map((r) => ({ ...r, showRate: showRateOf(r) }));
}

export function sumSegments(rows: SegmentStatRow[]): Record<SegCountKey, number> {
  const out = Object.fromEntries(SEG_COUNT_KEYS.map((k) => [k, 0])) as Record<SegCountKey, number>;
  for (const r of rows) for (const k of SEG_COUNT_KEYS) out[k] += r[k];
  return out;
}

// Bookings in the period that aren't credited to any registered segment.
export async function getOutsideSegmentDeals(range: DateRange, f: TeamFilter) {
  const dealDay = TORONTO_DAY("d.created_at");
  const [row] = await db.execute<{ meetings: number; activated: number }>(sql`
    select (select count(*)::int from team_deals d
        where d.segment_id is null and ${BDR_SOURCED} and d.meeting_status <> 'no_meeting'
          and d.booked_by_owner_id in (${teamOwnersSql(f)})
          and ${dealDay} between ${range.startDate} and ${range.endDate}) as meetings,
      (select count(*)::int from activated_leads a
        where a.segment_id is null and a.owner_id in (${teamOwnersSql(f)})
          and ${TORONTO_DAY("a.activated_at")} between ${range.startDate} and ${range.endDate}) as activated
  `);
  return { meetings: Number(row?.meetings ?? 0), activated: Number(row?.activated ?? 0) };
}

// --- Activated leads + follow-ups ------------------------------------------------

export type ActivatedLead = {
  contactId: string;
  contactName: string;
  companyName: string | null;
  jobTitle: string | null;
  ownerId: string;
  rep: string;
  activatedOn: string;
  daysWaiting: number;
  segmentId: number | null;
  campaignId: number | null;
};

// Every current activated lead (no period: they're open follow-ups until a
// deal exists), optionally only those activated inside `range`.
export async function getActivatedLeads(
  scope: { f: TeamFilter } | { segmentIds: number[] },
  range?: DateRange,
): Promise<ActivatedLead[]> {
  if ("segmentIds" in scope && scope.segmentIds.length === 0) return [];
  const who =
    "f" in scope
      ? sql`a.owner_id in (${teamOwnersSql(scope.f)})`
      : sql`a.segment_id in (${sql.join(scope.segmentIds.map((id) => sql`${id}`), sql`, `)})`;
  const day = TORONTO_DAY("a.activated_at");
  const inRange = range ? sql`${day} between ${range.startDate} and ${range.endDate}` : sql`true`;
  const rows = await db.execute<Record<string, unknown>>(sql`
    select a.contact_id, a.contact_name, a.company_name, a.job_title, a.owner_id, coalesce(tm.name, a.owner_id) as rep,
      ${day} as activated_on, extract(day from now() at time zone 'UTC' - a.activated_at)::int as days_waiting,
      a.segment_id, (select s.campaign_id from segments s where s.id = a.segment_id) as campaign_id
    from activated_leads a
    left join team_members tm on tm.hubspot_owner_id = a.owner_id
    where ${who} and ${inRange}
    order by a.activated_at desc
  `);
  return rows.map((r) => ({
    contactId: String(r.contact_id),
    contactName: (r.contact_name as string) ?? "(no name)",
    companyName: (r.company_name as string) ?? null,
    jobTitle: (r.job_title as string) ?? null,
    ownerId: String(r.owner_id),
    rep: String(r.rep),
    activatedOn: String(r.activated_on),
    daysWaiting: Number(r.days_waiting ?? 0),
    segmentId: r.segment_id == null ? null : Number(r.segment_id),
    campaignId: r.campaign_id == null ? null : Number(r.campaign_id),
  }));
}
