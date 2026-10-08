import Link from "next/link";
import { StatTile, StatTileRow } from "@/components/StatTile";
import { TeamTable } from "@/components/TeamTable";
import {
  ALL_BDRS,
  getNeedsAttention,
  getOutsideSegmentDeals,
  getSegmentStats,
  getTeamBookings,
  getTeamGroups,
  getTeamMonthly,
  getTeamStats,
  rollUpByCampaign,
  sumSegments,
  type Booking,
  type SegmentStatRow,
} from "@/lib/team-queries";
import { hubspotDealUrl } from "@/lib/hubspot";
import { todayInToronto } from "@/lib/timezone";

export const dynamic = "force-dynamic";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  held: { label: "Held", color: "var(--status-good)" },
  needs_rebook: { label: "Needs rebook", color: "var(--status-warning)" },
  no_show_lost: { label: "No-show – lost", color: "var(--status-critical)" },
  cancelled_lost: { label: "Cancelled – lost", color: "var(--status-serious)" },
  scheduled: { label: "Scheduled", color: "var(--series-blue)" },
  not_logged: { label: "Needs status", color: "var(--status-warning)" },
  no_meeting: { label: "Activated (no meeting)", color: "var(--series-violet)" },
};

function BookingsTable({ rows, empty, showDays }: { rows: Booking[]; empty: string; showDays?: boolean }) {
  return (
    <div className="hud-panel">
      <div className="overflow-x-auto rounded-lg">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="hud-heading border-b text-xs" style={{ borderColor: "var(--border-hairline)" }}>
              <th className="px-4 py-3 font-medium">Deal</th>
              <th className="px-4 py-3 font-medium">Booked by</th>
              <th className="px-4 py-3 font-medium">Booked</th>
              <th className="px-4 py-3 font-medium">Meeting</th>
              <th className="px-4 py-3 font-medium">Status</th>
              {showDays && <th className="px-4 py-3 font-medium">Waiting</th>}
              <th className="px-4 py-3 font-medium">BANT</th>
              <th className="px-4 py-3 font-medium">MQL</th>
              <th className="px-4 py-3 font-medium">SQL</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center" style={{ color: "var(--text-muted)" }}>
                  {empty}
                </td>
              </tr>
            )}
            {rows.map((b) => {
              const s = STATUS_LABELS[b.meetingStatus] ?? { label: b.meetingStatus, color: "var(--text-secondary)" };
              return (
                <tr key={b.dealId} className="border-t" style={{ borderColor: "var(--gridline)" }}>
                  <td className="px-4 py-3">
                    <a
                      href={hubspotDealUrl(b.dealId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                      style={{ color: "var(--series-blue)" }}
                    >
                      {b.dealName}
                    </a>
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                    {b.bookedBy}
                  </td>
                  <td className="px-4 py-3 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {b.bookedOn}
                  </td>
                  <td className="px-4 py-3 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {b.meetingOn ?? "—"}
                  </td>
                  <td className="px-4 py-3" style={{ color: s.color }}>
                    {s.label}
                    {b.rebooked && b.meetingStatus !== "needs_rebook" ? (
                      <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
                        (rebooked)
                      </span>
                    ) : null}
                    {b.statusSource === "auto" && b.meetingStatus !== "not_logged" && b.meetingStatus !== "no_meeting" ? (
                      <span
                        className="ml-1 text-xs"
                        style={{ color: "var(--text-muted)" }}
                        title="Inferred from meeting records — Intro Meeting Status not set on the deal"
                      >
                        · auto
                      </span>
                    ) : null}
                  </td>
                  {showDays && (
                    <td className="px-4 py-3 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                      {b.daysInStatus != null ? `${b.daysInStatus}d` : "—"}
                    </td>
                  )}
                  <td className="px-4 py-3">{b.bant ? <span style={{ color: "var(--series-aqua)" }}>✓</span> : "—"}</td>
                  <td className="px-4 py-3 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {b.mqlDate ?? "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {b.sqlDate ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

type Scope = "total" | "rep" | "campaign" | "segment";
const SCOPES: { key: Scope; label: string }[] = [
  { key: "total", label: "Total" },
  { key: "rep", label: "By rep" },
  { key: "campaign", label: "By campaign" },
  { key: "segment", label: "By segment" },
];

function pct(n: number, d: number) {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "—";
}

// Dials → Connects → Conversations → Activated → Meetings → BANT → MQL → SQL.
// Each step shows its conversion from `of` (a step label; default = the step
// before) — Activated and Meetings are parallel outcomes of a conversation,
// not one after the other, so both are measured against Conversations.
function Funnel({ steps }: { steps: { label: string; value: number; hint?: string; of?: string }[] }) {
  return (
    <div className="hud-panel overflow-x-auto p-4">
      <div className="flex min-w-max items-stretch gap-2">
        {steps.map((st, i) => (
          <div key={st.label} className="flex items-center gap-2">
            {i > 0 && (
              <div className="flex flex-col items-center px-1 text-xs" style={{ color: "var(--text-muted)" }}>
                <span>→</span>
                <span className="tabular-nums" title={`of ${st.of ?? steps[i - 1].label}`}>
                  {pct(st.value, (steps.find((x) => x.label === st.of) ?? steps[i - 1]).value)}
                </span>
              </div>
            )}
            <div className="min-w-[92px] rounded border px-3 py-2" style={{ borderColor: "var(--border-hairline)" }} title={st.hint}>
              <div className="hud-heading text-[10px]">{st.label}</div>
              <div className="text-xl font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {st.value.toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const SEG_COLS: { key: keyof SegmentStatRow; label: string; title?: string }[] = [
  { key: "leads", label: "Leads" },
  { key: "contacted", label: "Contacted", title: "At least 1 call from the rep inside the segment's dates" },
  { key: "dials", label: "Dials" },
  { key: "connected", label: "Connected" },
  { key: "conversations", label: "Convos" },
  { key: "notInterested", label: "Not int.", title: "Lead Status = Not Interested" },
  { key: "unqualified", label: "Unqual.", title: "Lead Status = Unqualified" },
  { key: "activated", label: "Activated", title: "Deal created, no meeting" },
  { key: "meetings", label: "Meetings" },
  { key: "bant", label: "BANT" },
  { key: "held", label: "Held" },
  { key: "showRate", label: "Show %" },
  { key: "mqls", label: "MQL" },
  { key: "sqls", label: "SQL" },
];

function SegmentTable({ rows, byCampaign }: { rows: SegmentStatRow[]; byCampaign: boolean }) {
  const cell = (r: SegmentStatRow, k: keyof SegmentStatRow) => {
    if (k === "showRate") return r.showRate == null ? "—" : `${r.showRate}%`;
    if (k === "contacted") return `${r.contacted} · ${pct(r.contacted, r.leads)}`;
    return String(r[k] ?? 0);
  };
  return (
    <div className="hud-panel">
      <div className="overflow-x-auto rounded-lg">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="hud-heading border-b text-xs" style={{ borderColor: "var(--border-hairline)" }}>
              <th className="px-3 py-3 font-medium">{byCampaign ? "Campaign" : "Segment"}</th>
              {!byCampaign && <th className="px-3 py-3 font-medium">Rep</th>}
              <th className="px-3 py-3 font-medium">Dates</th>
              {SEG_COLS.map((c) => (
                <th key={c.key} title={c.title} className="whitespace-nowrap px-3 py-3 text-right font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={SEG_COLS.length + 3} className="px-4 py-6 text-center" style={{ color: "var(--text-muted)" }}>
                  No segments registered for this group and period — register them on the Segments page.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={byCampaign ? r.campaignId : r.segmentId} className="border-t" style={{ borderColor: "var(--gridline)" }}>
                <td className="px-3 py-3" style={{ color: "var(--text-primary)" }}>
                  {byCampaign ? r.campaignName : r.listName}
                  {!byCampaign && (
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {r.campaignName}
                    </div>
                  )}
                </td>
                {!byCampaign && (
                  <td className="whitespace-nowrap px-3 py-3" style={{ color: "var(--text-secondary)" }}>
                    {r.rep}
                  </td>
                )}
                <td className="whitespace-nowrap px-3 py-3 text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
                  {r.startDate} → {r.endDate ?? "ongoing"}
                </td>
                {SEG_COLS.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-3 py-3 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {cell(r, c.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const today = todayInToronto();
  const groups = [...(await getTeamGroups()), ALL_BDRS];
  const group = str(sp.group) && groups.includes(str(sp.group)!) ? str(sp.group)! : (groups[0] ?? "Core BDRs");
  const view = str(sp.view) === "year" ? "year" : "month";
  const month = /^\d{4}-\d{2}$/.test(str(sp.month) ?? "") ? str(sp.month)! : today.slice(0, 7);
  const year = /^\d{4}$/.test(str(sp.year) ?? "") ? Number(str(sp.year)) : Number(today.slice(0, 4));
  const scope: Scope = SCOPES.some((x) => x.key === str(sp.scope)) ? (str(sp.scope) as Scope) : "total";
  const accounts = str(sp.unit) === "accounts";

  const range =
    view === "year"
      ? { startDate: `${year}-01-01`, endDate: `${year}-12-31` }
      : { startDate: `${month}-01`, endDate: lastDayOfMonth(month) };
  const periodLabel =
    view === "year" ? String(year) : `${MONTH_NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;

  const [stats, monthly, bookings, attention, segmentRows, outside] = await Promise.all([
    getTeamStats(range, group),
    view === "year" ? getTeamMonthly(year, group) : Promise.resolve(null),
    scope === "total" ? getTeamBookings(range, group) : Promise.resolve([]),
    scope === "total" ? getNeedsAttention(group) : Promise.resolve([]),
    scope === "campaign" || scope === "segment" ? getSegmentStats(range, group, accounts) : Promise.resolve([]),
    getOutsideSegmentDeals(range, group),
  ]);
  const t = stats.total;

  const params = {
    group,
    view,
    scope,
    ...(accounts ? { unit: "accounts" } : {}),
    ...(view === "year" ? { year: String(year) } : { month }),
  };
  const href = (overrides: Record<string, string>) => `/team?${new URLSearchParams({ ...params, ...overrides }).toString()}`;
  const pill = (active: boolean) =>
    active ? { background: "var(--series-blue)", color: "#04211f", borderColor: "var(--series-blue)" } : undefined;

  const segTotals = sumSegments(segmentRows);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Team Performance</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {group} · {periodLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {groups.map((g) => (
            <Link key={g} href={href({ group: g })} className="hud-button rounded-full px-3 py-1.5 text-xs" style={pill(g === group)}>
              {g}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {SCOPES.map((x) => (
          <Link key={x.key} href={href({ scope: x.key })} className="hud-button rounded-full px-3 py-1.5 text-xs" style={pill(scope === x.key)}>
            {x.label}
          </Link>
        ))}
        <span className="mx-2" style={{ color: "var(--gridline)" }}>
          |
        </span>
        <Link href={href({ view: "month", month })} className="hud-button rounded-full px-3 py-1.5 text-xs" style={pill(view === "month")}>
          Monthly
        </Link>
        <Link href={href({ view: "year", year: String(year) })} className="hud-button rounded-full px-3 py-1.5 text-xs" style={pill(view === "year")}>
          Yearly
        </Link>
        <span className="mx-1" />
        <Link
          href={view === "month" ? href({ month: shiftMonth(month, -1) }) : href({ year: String(year - 1) })}
          className="hud-button rounded px-2 py-1 text-xs"
        >
          ←
        </Link>
        <span className="px-2 text-sm" style={{ color: "var(--text-primary)" }}>
          {periodLabel}
        </span>
        <Link
          href={view === "month" ? href({ month: shiftMonth(month, 1) }) : href({ year: String(year + 1) })}
          className="hud-button rounded px-2 py-1 text-xs"
        >
          →
        </Link>
      </div>

      {scope === "total" && (
        <>
          <Funnel
            steps={[
              { label: "Dials", value: t.dials },
              { label: "Connects", value: t.connects },
              { label: "Conversations", value: t.conversations, hint: "Pitch / Past Pitch / Meeting outcomes" },
              { label: "Activated", value: t.activated, hint: "Deal created, no meeting" },
              { label: "Meetings", value: t.meetingsBooked, of: "Conversations" },
              { label: "BANT", value: t.bant },
              { label: "MQL", value: t.mqls, hint: "Entered Pre-Assessment / System Overview", of: "Meetings" },
              { label: "SQL", value: t.sqls, hint: "Entered the Sales Pipeline" },
            ]}
          />
          <StatTileRow>
            <StatTile label="Held" value={t.held} />
            <StatTile label="Show Rate" value={t.showRate == null ? "—" : `${t.showRate}%`} percent={t.showRate ?? undefined} />
            <StatTile label="Needs Rebook / Rebooked" value={`${t.needsRebook} / ${t.rebooked}`} />
            <StatTile label="No-show / Cancel Lost" value={`${t.noShowLost} / ${t.cancelledLost}`} />
          </StatTileRow>
        </>
      )}

      {(scope === "total" || scope === "rep") && (
        <div>
          <h2 className="mb-3 text-lg font-medium">{scope === "rep" ? "By rep" : "Leaderboard"}</h2>
          <TeamTable rows={stats.reps} total={stats.total} />
        </div>
      )}

      {monthly && (scope === "total" || scope === "rep") && (
        <div>
          <h2 className="mb-3 text-lg font-medium">{year} by month</h2>
          <TeamTable
            rows={monthly.map((m) => ({ ...m, name: MONTH_NAMES[Number(m.month.slice(5)) - 1] }))}
            total={{ ...stats.total, name: "Year total" }}
            firstColumnLabel="Month"
            sortable={false}
            showRank={false}
          />
        </div>
      )}

      {(scope === "campaign" || scope === "segment") && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={href({ unit: "people" })} className="hud-button rounded-full px-3 py-1.5 text-xs" style={pill(!accounts)}>
              People
            </Link>
            <Link href={href({ unit: "accounts" })} className="hud-button rounded-full px-3 py-1.5 text-xs" style={pill(accounts)}>
              Accounts
            </Link>
            <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
              Each segment counts only activity inside its own registered dates; the period above picks which segments are
              listed.
            </span>
          </div>
          <Funnel
            steps={[
              { label: accounts ? "Accounts" : "Leads", value: segTotals.leads },
              { label: "Contacted", value: segTotals.contacted },
              { label: "Connected", value: segTotals.connected },
              { label: "Conversations", value: segTotals.conversations },
              { label: "Activated", value: segTotals.activated },
              { label: "Meetings", value: segTotals.meetings, of: "Conversations" },
              { label: "BANT", value: segTotals.bant },
            ]}
          />
          <SegmentTable rows={scope === "campaign" ? rollUpByCampaign(segmentRows) : segmentRows} byCampaign={scope === "campaign"} />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Outside registered segments in {periodLabel}: {outside.meetings} meeting{outside.meetings === 1 ? "" : "s"} and{" "}
            {outside.activated} activated lead{outside.activated === 1 ? "" : "s"} (deal&apos;s contact isn&apos;t on any of the
            rep&apos;s segments, or was booked outside the segment&apos;s dates).
          </p>
        </>
      )}

      {scope === "total" && (
        <>
          <div>
            <h2 className="mb-1 text-lg font-medium">Needs attention</h2>
            <p className="mb-3 text-sm" style={{ color: "var(--text-muted)" }}>
              Open bookings for {group}, any month, whose meeting date passed with no <strong>Intro Meeting Status</strong>, or
              that are waiting on a rebook. Set the status on the deal in HubSpot to clear them.
            </p>
            <BookingsTable rows={attention} empty="Nothing waiting — every booking has a status." showDays />
          </div>
          <div>
            <h2 className="mb-3 text-lg font-medium">Deals booked · {periodLabel}</h2>
            <BookingsTable rows={bookings} empty="No BDR deals booked in this period." />
          </div>
        </>
      )}
    </div>
  );
}
