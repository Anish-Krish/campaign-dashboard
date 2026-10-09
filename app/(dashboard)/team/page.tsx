import Link from "next/link";
import { Suspense } from "react";
import { GroupSelect } from "@/components/perf/GroupSelect";
import { PerformanceView, type BreakdownRow, type Kpis, type Stage } from "@/components/perf/PerformanceView";
import {
  ALL_BDRS,
  getBookingsForSegments,
  getNeedsAttention,
  getOutsideSegmentDeals,
  getSegmentStats,
  getTeamBookings,
  getTeamGroups,
  getTeamMonthly,
  getTeamStats,
  getTeamWeekly,
  rollUpByCampaign,
  sumSegments,
  type Booking,
  type SegmentStatRow,
  type TeamStatRow,
} from "@/lib/team-queries";
import { todayInToronto } from "@/lib/timezone";

export const dynamic = "force-dynamic";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = MONTHS.map((m) => m.slice(0, 3));

type Scope = "total" | "rep" | "campaign" | "segment";
const SCOPES: { key: Scope; label: string }[] = [
  { key: "total", label: "Total" },
  { key: "rep", label: "Reps" },
  { key: "campaign", label: "Campaigns" },
  { key: "segment", label: "Segments" },
];

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
function shortDay(day: string) {
  return `${MON[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;
}

function kpisFromStats(t: TeamStatRow): Kpis {
  return {
    meetings: t.meetingsBooked,
    bant: t.bant,
    showRate: t.showRate,
    mqls: t.mqls,
    sqls: t.sqls,
    held: t.held,
    needsRebook: t.needsRebook,
    rebooked: t.rebooked,
    noShowLost: t.noShowLost,
    cancelledLost: t.cancelledLost,
    scheduled: t.scheduled,
    outcomeMissing: t.outcomeMissing,
  };
}

// Segment/campaign views: KPIs come from the deals credited to the listed
// segments (their own windows), so tiles, funnel and table always agree.
function kpisFromBookings(bs: Booking[]): Kpis {
  const c = (f: (b: Booking) => boolean) => bs.filter(f).length;
  const held = c((b) => b.meetingStatus === "held");
  const needsRebook = c((b) => b.meetingStatus === "needs_rebook");
  const noShowLost = c((b) => b.meetingStatus === "no_show_lost");
  const cancelledLost = c((b) => b.meetingStatus === "cancelled_lost");
  const resolved = held + needsRebook + noShowLost + cancelledLost;
  return {
    meetings: c((b) => b.meetingStatus !== "no_meeting"),
    bant: c((b) => b.bant),
    showRate: resolved > 0 ? Math.round((held / resolved) * 100) : null,
    mqls: c((b) => Boolean(b.mqlDate)),
    sqls: c((b) => Boolean(b.sqlDate)),
    held,
    needsRebook,
    rebooked: c((b) => b.rebooked),
    noShowLost,
    cancelledLost,
    scheduled: c((b) => b.meetingStatus === "scheduled"),
    outcomeMissing: c((b) => b.meetingStatus === "not_logged"),
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
    meetings: r.meetings,
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
  const groups = [ALL_BDRS, ...(await getTeamGroups())];
  // Opens on All BDRs so MQLs/SQLs from former reps' bookings always show (per the user).
  const group = str(sp.group) && groups.includes(str(sp.group)!) ? str(sp.group)! : ALL_BDRS;
  const view = str(sp.view) === "year" ? "year" : "month";
  const month = /^\d{4}-\d{2}$/.test(str(sp.month) ?? "") ? str(sp.month)! : today.slice(0, 7);
  const year = /^\d{4}$/.test(str(sp.year) ?? "") ? Number(str(sp.year)) : Number(today.slice(0, 4));
  const scope: Scope = SCOPES.some((x) => x.key === str(sp.scope)) ? (str(sp.scope) as Scope) : "total";
  const accounts = str(sp.unit) === "accounts";
  const segScope = scope === "campaign" || scope === "segment";

  const range =
    view === "year"
      ? { startDate: `${year}-01-01`, endDate: `${year}-12-31` }
      : { startDate: `${month}-01`, endDate: lastDayOfMonth(month) };
  const prevMonth = shiftMonth(month, -1);
  const prevRange =
    view === "year"
      ? { startDate: `${year - 1}-01-01`, endDate: `${year - 1}-12-31` }
      : { startDate: `${prevMonth}-01`, endDate: lastDayOfMonth(prevMonth) };
  const periodLabel = view === "year" ? String(year) : `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
  const prevLabel = view === "year" ? String(year - 1) : MON[Number(prevMonth.slice(5)) - 1];

  const [stats, prevStats, segRows, attention, outside] = await Promise.all([
    getTeamStats(range, group),
    segScope ? Promise.resolve(null) : getTeamStats(prevRange, group),
    getSegmentStats(range, group, accounts),
    getNeedsAttention(group),
    getOutsideSegmentDeals(range, group),
  ]);
  const bookings = segScope
    ? await getBookingsForSegments(segRows.map((r) => r.segmentId))
    : await getTeamBookings(range, group);

  // --- KPIs + funnel ---------------------------------------------------------
  const t = stats.total;
  const segTotals = sumSegments(segRows);
  const kpis = segScope ? kpisFromBookings(bookings) : kpisFromStats(t);
  const prevKpis = prevStats ? kpisFromStats(prevStats.total) : null;
  const convos = segScope ? segTotals.conversations : t.conversations;

  const activity: { title: string; stages: Stage[] } = segScope
    ? {
        title: accounts ? "Reach · accounts" : "Reach · people",
        stages: [
          { label: accounts ? "Accounts" : "Leads", value: segTotals.leads },
          { label: "Contacted", value: segTotals.contacted, hint: "At least one call inside the segment's dates" },
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
  const outcomes: Stage[] = [
    {
      label: "Activated",
      value: segScope ? segTotals.activated : t.activated,
      tone: "neutral",
      ofValue: convos,
      ofLabel: "conversations",
      hint: "Deal created, no meeting",
    },
    { label: "Meetings", value: kpis.meetings, ofValue: convos, ofLabel: "conversations" },
    { label: "BANT", value: kpis.bant, of: "Meetings" },
    { label: "MQL", value: kpis.mqls, of: "Meetings", hint: "Entered Pre-Assessment / System Overview" },
    { label: "SQL", value: kpis.sqls, of: "MQL", hint: "Entered the Sales Pipeline" },
  ];

  // --- Breakdown table (same columns in every view) ---------------------------
  let table: { title: string; firstCol: string; rows: BreakdownRow[]; total: BreakdownRow | null; note?: string };
  if (scope === "total") {
    if (view === "year") {
      const monthly = await getTeamMonthly(year, group);
      table = {
        title: `${year} by month`,
        firstCol: "Month",
        rows: monthly
          .filter((m) => m.month <= today.slice(0, 7))
          .map((m) =>
            rowFromStats(m, {
              key: m.month,
              name: MONTHS[Number(m.month.slice(5)) - 1],
              match: { from: `${m.month}-01`, to: lastDayOfMonth(m.month) },
            }),
          ),
        total: rowFromStats(t, { key: "total", name: "Total" }),
      };
    } else {
      const weekly = await getTeamWeekly(range, group);
      table = {
        title: `${periodLabel} by week`,
        firstCol: "Week",
        rows: weekly
          .filter((w) => w.week <= today)
          .map((w) => {
            const from = w.week < range.startDate ? range.startDate : w.week;
            const end = addDays(w.week, 6);
            const to = end > range.endDate ? range.endDate : end;
            return rowFromStats(w, { key: w.week, name: `${shortDay(from)} – ${shortDay(to)}`, match: { from, to } });
          }),
        total: rowFromStats(t, { key: "total", name: "Total" }),
      };
    }
  } else if (scope === "rep") {
    const byOwner = new Map<string, { leads: number; contacted: number }>();
    for (const s of segRows) {
      const cur = byOwner.get(s.ownerId) ?? { leads: 0, contacted: 0 };
      cur.leads += s.leads;
      cur.contacted += s.contacted;
      byOwner.set(s.ownerId, cur);
    }
    const leadSum = [...byOwner.values()].reduce(
      (a, b) => ({ leads: a.leads + b.leads, contacted: a.contacted + b.contacted }),
      { leads: 0, contacted: 0 },
    );
    const reps = [...stats.reps].sort((a, b) => b.meetingsBooked - a.meetingsBooked || b.dials - a.dials);
    table = {
      title: "Reps",
      firstCol: "Rep",
      rows: reps.map((r) =>
        rowFromStats(r, {
          leads: byOwner.get(r.ownerId)?.leads ?? null,
          contacted: byOwner.get(r.ownerId)?.contacted ?? null,
          match: { ownerId: r.ownerId },
        }),
      ),
      total: rowFromStats(t, {
        key: "total",
        name: "Total",
        leads: byOwner.size ? leadSum.leads : null,
        contacted: byOwner.size ? leadSum.contacted : null,
      }),
      note: "Leads and contacted come from each rep's registered segments",
    };
  } else {
    const rows = scope === "campaign" ? rollUpByCampaign(segRows) : segRows;
    table = {
      title: scope === "campaign" ? "Campaigns" : "Segments",
      firstCol: scope === "campaign" ? "Campaign" : "Segment",
      rows: rows.map((r) =>
        rowFromSegment(r, {
          sub:
            scope === "campaign"
              ? `${segRows.filter((s) => s.campaignId === r.campaignId).length} segments`
              : `${r.rep} · ${shortDay(r.startDate)} → ${r.endDate ? shortDay(r.endDate) : "ongoing"}`,
          match: scope === "campaign" ? { campaignId: r.campaignId } : { segmentId: r.segmentId },
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
        meetings: segTotals.meetings,
        bant: segTotals.bant,
        showRate: kpis.showRate,
        mqls: segTotals.mqls,
        sqls: segTotals.sqls,
      },
      note: `Each segment counts only activity inside its own dates · outside any segment in ${periodLabel}: ${outside.meetings} meetings, ${outside.activated} activated`,
    };
  }

  // --- Controls ---------------------------------------------------------------
  const params: Record<string, string> = {
    ...(group !== ALL_BDRS ? { group } : {}),
    view,
    scope,
    ...(accounts ? { unit: "accounts" } : {}),
    ...(view === "year" ? { year: String(year) } : { month }),
  };
  const href = (o: Record<string, string>) => `/team?${new URLSearchParams({ ...params, ...o }).toString()}`;
  const prevHref = view === "month" ? href({ month: prevMonth }) : href({ year: String(year - 1) });
  const nextHref = view === "month" ? href({ month: shiftMonth(month, 1) }) : href({ year: String(year + 1) });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Performance
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          {group} · {periodLabel}
          {segScope ? " · segments active in this period" : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Suspense>
          <GroupSelect groups={groups} value={group} />
        </Suspense>
        <nav className="seg" aria-label="View">
          {SCOPES.map((x) => (
            <Link key={x.key} href={href({ scope: x.key })} aria-current={scope === x.key}>
              {x.label}
            </Link>
          ))}
        </nav>
        <div className="flex-1" />
        {segScope && (
          <nav className="seg" aria-label="Count">
            <Link href={href({ unit: "people" })} aria-current={!accounts}>
              People
            </Link>
            <Link href={href({ unit: "accounts" })} aria-current={accounts}>
              Accounts
            </Link>
          </nav>
        )}
        <nav className="seg" aria-label="Period">
          <Link href={href({ view: "month", month })} aria-current={view === "month"}>
            Month
          </Link>
          <Link href={href({ view: "year", year: String(year) })} aria-current={view === "year"}>
            Year
          </Link>
        </nav>
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
      </div>

      <PerformanceView
        kpis={kpis}
        prevKpis={prevKpis}
        prevLabel={prevKpis ? prevLabel : null}
        activity={activity}
        outcomes={outcomes}
        table={table}
        bookings={bookings}
        attention={attention}
      />
    </div>
  );
}
