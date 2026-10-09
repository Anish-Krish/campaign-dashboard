import Link from "next/link";
import { Suspense } from "react";
import { desc, eq } from "drizzle-orm";
import { GoalEditor } from "@/components/perf/GoalEditor";
import { GoalProgress, Leaderboard, type LeaderRow } from "@/components/perf/Leaderboard";
import { RefreshButton } from "@/components/perf/RefreshButton";
import { RepPicker } from "@/components/perf/RepPicker";
import { LiveFeed } from "@/components/live/LiveFeed";
import { FollowUps } from "@/components/perf/FollowUps";
import { commissionFor, getCommissionConfig, money } from "@/lib/commission";
import { PerformanceView, type BreakdownRow, type Kpis, type Stage } from "@/components/perf/PerformanceView";
import {
  ALL_BDRS,
  getActivatedLeads,
  getBookingsForSegments,
  getIntroAttempts,
  getNeedsAttention,
  getOutsideSegmentDeals,
  getSegmentStats,
  getTeamBookings,
  getTeamMembers,
  getTeamMonthly,
  getTeamStats,
  getTeamWeekly,
  rollUpByCampaign,
  showRateOf,
  sumSegments,
  type CountMode,
  type DateRange,
  type SegmentStatRow,
  type TeamFilter,
  type TeamStatRow,
} from "@/lib/team-queries";
import { db } from "@/lib/db";
import { bdrCampaigns, syncRuns } from "@/lib/db/schema";
import { todayInToronto } from "@/lib/timezone";
import { activeReps, getGoals, paceFraction } from "@/lib/goals";
import { getCurrentUser } from "@/lib/session";
import { saveGoals } from "./actions";

export const dynamic = "force-dynamic";
// the Refresh server action runs a ~40s HubSpot pull
export const maxDuration = 300;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = MONTHS.map((m) => m.slice(0, 3));

type Scope = "total" | "rep" | "follow" | "campaign" | "segment";
const SCOPES: { key: Scope; label: string }[] = [
  { key: "total", label: "Total" },
  { key: "rep", label: "Leaderboard" },
  { key: "follow", label: "Follow-ups" },
  { key: "campaign", label: "Campaigns" },
  { key: "segment", label: "Segments" },
];
type View = "month" | "year" | "custom";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}
function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
function shortDay(day: string) {
  return `${MON[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;
}
function rangeLabel(r: DateRange) {
  const sameYear = r.startDate.slice(0, 4) === r.endDate.slice(0, 4);
  return `${shortDay(r.startDate)}${sameYear ? "" : `, ${r.startDate.slice(0, 4)}`} – ${shortDay(r.endDate)}, ${r.endDate.slice(0, 4)}`;
}

type DealCountsLike = {
  meetingsBooked: number;
  sat: number;
  noShows: number;
  cancels: number;
  missRebook: number;
  missRebooked: number;
  missLost: number;
  outcomeMissing: number;
  scheduled: number;
  bant: number;
  mqls: number;
  sqls: number;
};

// Same shape for rep stats and summed segments, so tiles/funnel/table agree.
function kpisOf(t: DealCountsLike): Kpis {
  return {
    meetings: t.meetingsBooked,
    sat: t.sat,
    showRate: showRateOf(t),
    bant: t.bant,
    mqls: t.mqls,
    sqls: t.sqls,
    noShows: t.noShows,
    cancels: t.cancels,
    needsRebook: t.missRebook,
    rebooked: t.missRebooked,
    lost: t.missLost,
    outcomeMissing: t.outcomeMissing,
    scheduled: t.scheduled,
  };
}

function rowFromStats(r: TeamStatRow, extra: Partial<BreakdownRow> = {}): BreakdownRow {
  return {
    key: r.ownerId,
    name: r.name,
    leads: null,
    contacted: null,
    dials: r.dials,
    connects: r.connects,
    convos: r.conversations,
    activated: r.activated,
    meetings: r.meetingsBooked,
    sat: r.sat,
    bant: r.bant,
    showRate: r.showRate,
    mqls: r.mqls,
    sqls: r.sqls,
    ...extra,
  };
}

function rowFromSegment(r: SegmentStatRow, extra: Partial<BreakdownRow> = {}): BreakdownRow {
  return {
    key: String(r.segmentId || r.campaignId),
    name: r.listName || r.campaignName,
    leads: r.leads,
    contacted: r.contacted,
    dials: r.dials,
    connects: r.connected,
    convos: r.conversations,
    activated: r.activated,
    meetings: r.meetingsBooked,
    sat: r.sat,
    bant: r.bant,
    showRate: r.showRate,
    mqls: r.mqls,
    sqls: r.sqls,
    ...extra,
  };
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const today = todayInToronto();
  const [user, members, campaignRows, [lastRun], commissionCfg] = await Promise.all([
    getCurrentUser(),
    getTeamMembers(),
    db.select({ id: bdrCampaigns.id, name: bdrCampaigns.name }).from(bdrCampaigns),
    db
      .select({ finishedAt: syncRuns.finishedAt })
      .from(syncRuns)
      .where(eq(syncRuns.status, "success"))
      .orderBy(desc(syncRuns.id))
      .limit(1),
    getCommissionConfig(),
  ]);
  // Team = every BDR, current and former, so MQLs/SQLs from former reps'
  // bookings still count (per the user). The rep picker narrows the whole
  // page to one rep; a campaign can be focused on top of that.
  const group = ALL_BDRS;
  const scopeParam: Scope = SCOPES.some((x) => x.key === str(sp.scope)) ? (str(sp.scope) as Scope) : "total";
  const leaderboard = scopeParam === "rep";
  const followUps = scopeParam === "follow";
  const focusRep = leaderboard ? null : (members.find((m) => m.hubspotOwnerId === str(sp.rep)) ?? null);
  const focusCampaign = leaderboard || followUps ? null : (campaignRows.find((c) => String(c.id) === str(sp.campaign)) ?? null);
  const f: TeamFilter = { group, ownerId: focusRep?.hubspotOwnerId };

  // "When it happened" (default) vs "When it was booked" (the history view:
  // what became of the meetings set in the period). The leaderboard is always
  // "when it happened" — BANT meetings set this period is what's paid on.
  const mode: CountMode = str(sp.count) === "booked" && !leaderboard ? "cohort" : "activity";
  const cohort = mode === "cohort";

  // --- Period -------------------------------------------------------------------
  const rawFrom = str(sp.from) ?? "";
  const rawTo = str(sp.to) ?? "";
  const customOk = DAY_RE.test(rawFrom) && DAY_RE.test(rawTo);
  const view: View = str(sp.view) === "year" ? "year" : str(sp.view) === "custom" && customOk ? "custom" : "month";
  const month = /^\d{4}-\d{2}$/.test(str(sp.month) ?? "") ? str(sp.month)! : today.slice(0, 7);
  const year = /^\d{4}$/.test(str(sp.year) ?? "") ? Number(str(sp.year)) : Number(today.slice(0, 4));
  const [cFrom, cTo] = rawFrom <= rawTo ? [rawFrom, rawTo] : [rawTo, rawFrom];

  let range: DateRange;
  let prevRange: DateRange;
  let periodLabel: string;
  let prevLabel: string;
  const prevMonth = shiftMonth(month, -1);
  if (view === "year") {
    range = { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
    prevRange = { startDate: `${year - 1}-01-01`, endDate: `${year - 1}-12-31` };
    periodLabel = String(year);
    prevLabel = String(year - 1);
  } else if (view === "custom") {
    range = { startDate: cFrom, endDate: cTo };
    const span = daysBetween(cFrom, cTo) + 1;
    prevRange = { startDate: addDays(cFrom, -span), endDate: addDays(cFrom, -1) };
    periodLabel = rangeLabel(range);
    prevLabel = `prior ${span}d`;
  } else {
    range = { startDate: `${month}-01`, endDate: lastDayOfMonth(month) };
    prevRange = { startDate: `${prevMonth}-01`, endDate: lastDayOfMonth(prevMonth) };
    periodLabel = `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
    prevLabel = MON[Number(prevMonth.slice(5)) - 1];
  }

  // A focused campaign always shows its segments.
  const scope: Scope = focusCampaign ? "segment" : scopeParam;
  const accounts = str(sp.unit) === "accounts";
  const segScope = scope === "campaign" || scope === "segment";

  const [goalSet, stats, prevStats, segRows, prevSegRows, attention, outside] = await Promise.all([
    getGoals(range, members),
    getTeamStats(range, f, mode),
    segScope ? Promise.resolve(null) : getTeamStats(prevRange, f, mode),
    getSegmentStats(range, f, accounts, focusCampaign?.id, mode),
    segScope ? getSegmentStats(prevRange, f, accounts, focusCampaign?.id, mode) : Promise.resolve([]),
    getNeedsAttention(f),
    getOutsideSegmentDeals(range, f),
  ]);
  const segIds = segRows.map((r) => r.segmentId);
  const [bookings, attempts, activatedLeads, openActivated] = await Promise.all([
    segScope ? getBookingsForSegments(segIds, range, mode) : getTeamBookings(range, f, mode),
    getIntroAttempts(range, segScope ? { segmentIds: segIds } : { f }, mode),
    getActivatedLeads(segScope ? { segmentIds: segIds } : { f }, range),
    followUps ? getActivatedLeads({ f }) : Promise.resolve([]),
  ]);

  // --- KPIs + funnel ---------------------------------------------------------
  const t = stats.total;
  const segTotals = sumSegments(segRows);
  const kpis = segScope ? kpisOf(segTotals) : kpisOf(t);
  const prevKpis = segScope ? kpisOf(sumSegments(prevSegRows)) : prevStats ? kpisOf(prevStats.total) : null;
  const convos = segScope ? segTotals.conversations : t.conversations;

  const activity: { title: string; stages: Stage[] } = segScope
    ? {
        title: accounts ? "Reach · accounts" : "Reach · people",
        stages: [
          { label: accounts ? "Accounts" : "Leads", value: segTotals.leads, hint: "Everyone on the segment lists today" },
          { label: "Contacted", value: segTotals.contacted, hint: "At least one call in this period" },
          { label: "Connected", value: segTotals.connected },
          { label: "Conversations", value: segTotals.conversations, hint: "Pitch / Past Pitch / Meeting outcomes" },
        ],
      }
    : {
        title: "Activity · calls",
        stages: [
          { label: "Dials", value: t.dials },
          { label: "Connects", value: t.connects },
          { label: "Conversations", value: t.conversations, hint: "Pitch / Past Pitch / Meeting outcomes" },
        ],
      };
  // In the history view every stage is the same group of bookings, so each
  // is a true % of meetings set; in the main view they're separate events,
  // so only the call-based rates are shown.
  const outcomes: Stage[] = [
    {
      label: "Activated",
      value: segScope ? segTotals.activated : t.activated,
      tone: "neutral",
      ofValue: convos,
      ofLabel: "conversations",
      hint: "Contact set to Open Deal, no deal yet",
    },
    { label: "Meetings set", value: kpis.meetings, ofValue: convos, ofLabel: "conversations" },
    cohort
      ? { label: "Sat", value: kpis.sat, of: "Meetings set", hint: "Of these bookings, how many intros happened" }
      : { label: "Sat", value: kpis.sat, noBase: true, hint: "Intro meetings that happened in this period" },
    cohort ? { label: "BANT", value: kpis.bant, of: "Meetings set" } : { label: "BANT", value: kpis.bant, noBase: true },
    cohort
      ? { label: "MQL", value: kpis.mqls, of: "Meetings set", hint: "Reached Pre-Assessment / System Overview" }
      : { label: "MQL", value: kpis.mqls, noBase: true, hint: "Entered Pre-Assessment / System Overview" },
    cohort
      ? { label: "SQL", value: kpis.sqls, of: "MQL", hint: "Reached the Sales Pipeline" }
      : { label: "SQL", value: kpis.sqls, noBase: true, hint: "Entered the Sales Pipeline" },
  ];

  // --- Links ---------------------------------------------------------------------
  const periodParams: Record<string, string> =
    view === "year" ? { view, year: String(year) } : view === "custom" ? { view, from: cFrom, to: cTo } : { view, month };
  const base: Record<string, string> = {
    ...periodParams,
    scope: scopeParam,
    ...(accounts ? { unit: "accounts" } : {}),
    ...(cohort ? { count: "booked" } : {}),
  };
  const focusParams: Record<string, string> = focusRep
    ? { rep: focusRep.hubspotOwnerId }
    : focusCampaign
      ? { campaign: String(focusCampaign.id) }
      : {};
  const build = (o: Record<string, string>) => {
    const p = new URLSearchParams(o);
    if (p.get("count") === "happened") p.delete("count");
    return `/team?${p.toString()}`;
  };
  // keeps the current focus (period / unit changes)
  const href = (o: Record<string, string>) => build({ ...base, ...focusParams, ...o });
  // drops the focus (scope switches, "back")
  const unfocused = (o: Record<string, string>) => build({ ...base, ...o });

  let prevHref: string;
  let nextHref: string;
  if (view === "month") {
    prevHref = href({ month: prevMonth });
    nextHref = href({ month: shiftMonth(month, 1) });
  } else if (view === "year") {
    prevHref = href({ year: String(year - 1) });
    nextHref = href({ year: String(year + 1) });
  } else {
    const span = daysBetween(cFrom, cTo) + 1;
    prevHref = href({ from: addDays(cFrom, -span), to: addDays(cTo, -span) });
    nextHref = href({ from: addDays(cFrom, span), to: addDays(cTo, span) });
  }

  // --- Breakdown table (same columns in every view) ---------------------------
  type Table = {
    title: string;
    firstCol: string;
    rows: BreakdownRow[];
    total: BreakdownRow | null;
    note?: string;
    defaultSort?: { key: string; dir: "asc" | "desc" };
  };
  let table: Table;
  if (scope === "total") {
    // Weeks for a month-sized period, months for anything longer.
    const byMonth = view === "year" || (view === "custom" && daysBetween(range.startDate, range.endDate) > 62);
    const totalRow = rowFromStats(t, { key: "total", name: "Total" });
    const who = focusRep ? `${focusRep.name} · ` : "";
    if (byMonth) {
      const monthly = await getTeamMonthly(range, f, mode);
      table = {
        title: `${who}${periodLabel} by month`,
        firstCol: "Month",
        rows: monthly
          .filter((m) => m.month <= today.slice(0, 7))
          .map((m) => {
            const from = `${m.month}-01` < range.startDate ? range.startDate : `${m.month}-01`;
            const to = lastDayOfMonth(m.month) > range.endDate ? range.endDate : lastDayOfMonth(m.month);
            return rowFromStats(m, {
              key: m.month,
              name: `${MONTHS[Number(m.month.slice(5)) - 1]}${view === "year" ? "" : ` ${m.month.slice(0, 4)}`}`,
              match: { from, to },
            });
          }),
        total: totalRow,
      };
    } else {
      const weekly = await getTeamWeekly(range, f, mode);
      table = {
        title: `${who}${periodLabel} by week`,
        firstCol: "Week",
        rows: weekly
          .filter((w) => w.week <= today)
          .map((w) => {
            const from = w.week < range.startDate ? range.startDate : w.week;
            const end = addDays(w.week, 6);
            const to = end > range.endDate ? range.endDate : end;
            return rowFromStats(w, { key: w.week, name: `${shortDay(from)} – ${shortDay(to)}`, match: { from, to } });
          }),
        total: totalRow,
      };
    }
  } else if (scope === "rep" || scope === "follow") {
    // The leaderboard renders its own component (below); the table is unused.
    table = { title: "", firstCol: "", rows: [], total: null };
  } else {
    const rows = scope === "campaign" ? rollUpByCampaign(segRows) : segRows;
    table = {
      title: focusCampaign ? `${focusCampaign.name} · segments` : scope === "campaign" ? "Campaigns" : "Segments",
      firstCol: scope === "campaign" ? "Campaign" : "Segment",
      rows: rows.map((r) =>
        rowFromSegment(r, {
          sub:
            scope === "campaign"
              ? `${segRows.filter((s) => s.campaignId === r.campaignId).length} segments`
              : `${r.rep} · ${shortDay(r.startDate)} → ${r.endDate ? shortDay(r.endDate) : "ongoing"}`,
          match: scope === "campaign" ? { campaignId: r.campaignId } : { segmentId: r.segmentId },
          href: scope === "campaign" ? unfocused({ scope: "campaign", campaign: String(r.campaignId) }) : undefined,
        }),
      ),
      total: {
        key: "total",
        name: "Total",
        leads: segTotals.leads,
        contacted: segTotals.contacted,
        dials: segTotals.dials,
        connects: segTotals.connected,
        convos: segTotals.conversations,
        activated: segTotals.activated,
        meetings: segTotals.meetingsBooked,
        sat: segTotals.sat,
        bant: segTotals.bant,
        showRate: kpis.showRate,
        mqls: segTotals.mqls,
        sqls: segTotals.sqls,
      },
      note:
        [
          scope === "campaign" ? "Click a campaign to see it split by segment" : null,
          !focusCampaign && outside.meetings + outside.activated > 0
            ? `Not on any registered list: ${outside.meetings} meeting${outside.meetings === 1 ? "" : "s"}, ${outside.activated} activated`
            : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
      defaultSort: { key: "bant", dir: "desc" },
    };
  }

  // --- Goals ------------------------------------------------------------------------
  const isAdmin = user?.role === "admin";
  const repsInPeriod = activeReps(members, range);
  const pace = paceFraction(range, today);
  const daysLeft = range.endDate >= today && range.startDate <= today ? daysBetween(today, range.endDate) : null;
  const teamGoal = goalSet.team;
  const repGoal = focusRep ? (goalSet.byRep.get(focusRep.hubspotOwnerId) ?? null) : null;
  const monthRange = view === "month" ? range : null;
  const editor =
    isAdmin && monthRange ? (
      <GoalEditor
        month={month}
        monthLabel={periodLabel}
        team={goalSet.monthTeam}
        reps={activeReps(members, monthRange).map((m) => ({
          id: m.hubspotOwnerId,
          name: m.name,
          override: goalSet.monthOverrides.get(m.hubspotOwnerId) ?? null,
          share: goalSet.monthShares.get(m.hubspotOwnerId) ?? null,
        }))}
        action={saveGoals}
      />
    ) : null;

  // Commission tiers are monthly, so it's shown on the Month view only.
  const showCommission = view === "month" && (commissionCfg.visible || isAdmin);
  const commissionOf = (bant: number) => (showCommission ? commissionFor(bant, commissionCfg) : null);
  const leaderRows: LeaderRow[] = stats.reps
    .filter((r) => repsInPeriod.some((m) => m.hubspotOwnerId === r.ownerId))
    .map((r) => ({
      ownerId: r.ownerId,
      name: r.name,
      href: build({ ...base, scope: "total", rep: r.ownerId }),
      bant: r.bant,
      goal: goalSet.byRep.get(r.ownerId) ?? null,
      meetingsSet: r.meetingsBooked,
      sat: r.sat,
      showRate: r.showRate,
      mqls: r.mqls,
      sqls: r.sqls,
      dials: r.dials,
      conversations: r.conversations,
      commission: commissionOf(r.bant),
    }));
  const teamCommission = leaderRows.reduce((n, r) => n + (r.commission?.total ?? 0), 0);
  const repCommission = focusRep ? commissionOf(stats.reps.find((r) => r.ownerId === focusRep.hubspotOwnerId)?.bant ?? 0) : null;
  const commissionNote = showCommission
    ? `${money(commissionCfg.base)} per BANT meeting, ${money(commissionCfg.high)} after ${commissionCfg.threshold}${
        commissionCfg.visible ? "" : " · hidden from reps"
      }`
    : null;

  // --- Rep picker -----------------------------------------------------------------
  const pickScope = leaderboard ? "total" : scopeParam;
  const repOption = (m: (typeof members)[number]) => ({
    id: m.hubspotOwnerId,
    name: m.name,
    href: build({ ...base, ...(focusCampaign ? { campaign: String(focusCampaign.id) } : {}), scope: pickScope, rep: m.hubspotOwnerId }),
    current: focusRep?.hubspotOwnerId === m.hubspotOwnerId,
  });
  const currentReps = members.filter((m) => m.role === "bdr" && (!m.endDate || m.endDate >= today));
  const formerReps = members.filter((m) => !currentReps.includes(m));
  const teamHref = build({ ...base, ...(focusCampaign ? { campaign: String(focusCampaign.id) } : {}), scope: pickScope });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <RepPicker
            label={focusRep?.name ?? null}
            teamHref={teamHref}
            reps={currentReps.map(repOption)}
            former={formerReps.map(repOption)}
          />
          <p className="mt-1 pl-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {leaderboard ? "Leaderboard" : focusCampaign ? focusCampaign.name : focusRep ? "Rep view" : "All BDRs"} · {periodLabel}
            {cohort ? ` · what became of the meetings set in ${periodLabel}` : ""}
          </p>
        </div>
        <RefreshButton lastSyncedAt={lastRun?.finishedAt ? lastRun.finishedAt.toISOString() : null} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <nav className="seg" aria-label="View">
          {SCOPES.map((x) => (
            <Link
              key={x.key}
              href={build({ ...base, ...(focusRep && x.key !== "rep" ? { rep: focusRep.hubspotOwnerId } : {}), scope: x.key })}
              aria-current={!focusCampaign && scopeParam === x.key}
            >
              {x.label}
            </Link>
          ))}
        </nav>
        {focusCampaign && (
          <Link
            href={build({ ...base, ...(focusRep ? { rep: focusRep.hubspotOwnerId } : {}), scope: "campaign" })}
            className="btn px-2.5 py-1.5"
            title="Back to all campaigns"
          >
            ✕ {focusCampaign.name}
          </Link>
        )}
        <div className="flex-1" />
        {segScope && (
          <nav className="seg" aria-label="Count people or accounts">
            <Link href={href({ unit: "people" })} aria-current={!accounts}>
              People
            </Link>
            <Link href={href({ unit: "accounts" })} aria-current={accounts}>
              Accounts
            </Link>
          </nav>
        )}
        {!leaderboard && !followUps && (
          <nav className="seg" aria-label="Counted by">
            <Link
              href={href({ count: "happened" })}
              aria-current={!cohort}
              title="Every number in the period it happened: meetings set, sat, BANT ticked, MQL/SQL entered"
            >
              When it happened
            </Link>
            <Link
              href={href({ count: "booked" })}
              aria-current={cohort}
              title="Of the meetings set in the period: how many sat, became BANT, MQL, SQL — whenever that happened"
            >
              When booked
            </Link>
          </nav>
        )}
        {!followUps && (
        <nav className="seg" aria-label="Period">
          <Link href={href({ view: "month", month })} aria-current={view === "month"}>
            Month
          </Link>
          <Link href={href({ view: "year", year: String(year) })} aria-current={view === "year"}>
            Year
          </Link>
          <Link
            href={href({
              view: "custom",
              from: view === "custom" ? cFrom : range.startDate,
              to: view === "custom" ? cTo : range.endDate > today ? today : range.endDate,
            })}
            aria-current={view === "custom"}
          >
            Custom
          </Link>
        </nav>
        )}
        {followUps ? null : view === "custom" ? (
          <form action="/team" method="get" className="flex items-center gap-2">
            {Object.entries({ ...base, ...focusParams })
              .filter(([k]) => k !== "from" && k !== "to")
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
            <input type="date" name="from" defaultValue={cFrom} className="input w-auto py-1.5" aria-label="From" />
            <span style={{ color: "var(--text-muted)" }}>–</span>
            <input type="date" name="to" defaultValue={cTo} className="input w-auto py-1.5" aria-label="To" />
            <button type="submit" className="btn btn-primary px-3 py-1.5">
              Apply
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-1">
            <Link href={prevHref} className="btn px-2.5 py-1.5" aria-label="Previous period">
              ‹
            </Link>
            <span className="min-w-[120px] text-center text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {periodLabel}
            </span>
            <Link href={nextHref} className="btn px-2.5 py-1.5" aria-label="Next period">
              ›
            </Link>
          </div>
        )}
        {followUps && (
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            Open right now · not tied to a period
          </span>
        )}
      </div>

      {followUps ? (
        <FollowUps
          attention={attention}
          activated={openActivated}
          focused={Boolean(focusRep)}
          reps={currentReps.map((m) => ({
            ownerId: m.hubspotOwnerId,
            name: m.name,
            href: build({ ...base, scope: "follow", rep: m.hubspotOwnerId }),
          }))}
        />
      ) : leaderboard ? (
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
          <GoalProgress
            eyebrow={`Team goal · ${periodLabel}`}
            actual={t.bant}
            target={teamGoal}
            pace={pace}
            daysLeft={daysLeft}
            editor={editor}
            stats={[
              { label: "Meetings set", value: String(t.meetingsBooked) },
              { label: "Sat", value: String(t.sat) },
              { label: "Show rate", value: t.showRate == null ? "—" : `${t.showRate}%` },
              { label: "MQL", value: String(t.mqls) },
              { label: "SQL", value: String(t.sqls) },
              ...(showCommission ? [{ label: "Commission", value: money(teamCommission) }] : []),
            ]}
          />
          <Leaderboard rows={leaderRows} periodLabel={periodLabel} commissionNote={commissionNote} />
          </div>
          <div className="xl:sticky xl:top-20">
            <LiveFeed />
          </div>
        </div>
      ) : (
        <>
          {scope === "total" && !cohort && (
            <GoalProgress
              eyebrow={focusRep ? `${focusRep.name.split(" ")[0]}'s goal · ${periodLabel}` : `Team goal · ${periodLabel}`}
              actual={t.bant}
              target={focusRep ? repGoal : teamGoal}
              pace={pace}
              daysLeft={daysLeft}
              editor={editor}
              stats={
                repCommission
                  ? [
                      { label: "Commission", value: money(repCommission.total) },
                      {
                        label: repCommission.atHigh ? "Rate" : `To ${money(commissionCfg.high)} rate`,
                        value: repCommission.atHigh ? `${money(commissionCfg.high)}/mtg` : `${repCommission.toNextTier} more`,
                      },
                    ]
                  : []
              }
            />
          )}
      <PerformanceView
        kpis={kpis}
        prevKpis={prevKpis}
        prevLabel={prevKpis ? prevLabel : null}
        activity={activity}
        outcomes={outcomes}
        table={table}
        bookings={bookings}
        attempts={attempts}
        attention={attention}
        activatedLeads={activatedLeads}
        range={range}
        cohort={cohort}
      />
        </>
      )}
    </div>
  );
}
