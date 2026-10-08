import Link from "next/link";
import { StatTile, StatTileRow } from "@/components/StatTile";
import { TeamTable } from "@/components/TeamTable";
import { getNeedsAttention, getTeamBookings, getTeamGroups, getTeamMonthly, getTeamStats, type Booking } from "@/lib/team-queries";
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
  no_meeting: { label: "No meeting in HubSpot", color: "var(--text-muted)" },
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

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const today = todayInToronto();
  const groups = await getTeamGroups();
  const group = str(sp.group) && groups.includes(str(sp.group)!) ? str(sp.group)! : (groups[0] ?? "Core BDRs");
  const view = str(sp.view) === "year" ? "year" : "month";
  const month = /^\d{4}-\d{2}$/.test(str(sp.month) ?? "") ? str(sp.month)! : today.slice(0, 7);
  const year = /^\d{4}$/.test(str(sp.year) ?? "") ? Number(str(sp.year)) : Number(today.slice(0, 4));

  const range =
    view === "year"
      ? { startDate: `${year}-01-01`, endDate: `${year}-12-31` }
      : { startDate: `${month}-01`, endDate: lastDayOfMonth(month) };
  const periodLabel =
    view === "year" ? String(year) : `${MONTH_NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;

  const [stats, monthly, bookings, attention] = await Promise.all([
    getTeamStats(range, group),
    view === "year" ? getTeamMonthly(year, group) : Promise.resolve(null),
    getTeamBookings(range, group),
    getNeedsAttention(group),
  ]);
  const t = stats.total;

  const href = (overrides: Record<string, string>) => {
    const p = new URLSearchParams({ group, view, ...(view === "year" ? { year: String(year) } : { month }), ...overrides });
    return `/team?${p.toString()}`;
  };
  const pill = (active: boolean) =>
    active
      ? { background: "var(--series-blue)", color: "#04211f", borderColor: "var(--series-blue)" }
      : undefined;

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
        <Link href={href({ view: "month", month })} className="hud-button rounded-full px-3 py-1.5 text-xs" style={pill(view === "month")}>
          Monthly
        </Link>
        <Link
          href={href({ view: "year", year: String(year) })}
          className="hud-button rounded-full px-3 py-1.5 text-xs"
          style={pill(view === "year")}
        >
          Yearly
        </Link>
        <span className="mx-2" style={{ color: "var(--gridline)" }}>
          |
        </span>
        {view === "month" ? (
          <>
            <Link href={href({ month: shiftMonth(month, -1) })} className="hud-button rounded px-2 py-1 text-xs">
              ←
            </Link>
            <span className="px-2 text-sm" style={{ color: "var(--text-primary)" }}>
              {periodLabel}
            </span>
            <Link href={href({ month: shiftMonth(month, 1) })} className="hud-button rounded px-2 py-1 text-xs">
              →
            </Link>
          </>
        ) : (
          <>
            <Link href={href({ year: String(year - 1) })} className="hud-button rounded px-2 py-1 text-xs">
              ←
            </Link>
            <span className="px-2 text-sm" style={{ color: "var(--text-primary)" }}>
              {year}
            </span>
            <Link href={href({ year: String(year + 1) })} className="hud-button rounded px-2 py-1 text-xs">
              →
            </Link>
          </>
        )}
      </div>

      <StatTileRow>
        <StatTile label="Dials" value={t.dials.toLocaleString()} />
        <StatTile label="Connects" value={`${t.connects} · ${t.connectRate}%`} />
        <StatTile label="Meetings Booked" value={t.meetingsBooked} />
        <StatTile label="BANT Meetings" value={t.bant} />
        <StatTile label="Held" value={t.held} />
        <StatTile label="Show Rate" value={t.showRate == null ? "—" : `${t.showRate}%`} percent={t.showRate ?? undefined} />
        <StatTile label="Needs Rebook / Rebooked" value={`${t.needsRebook} / ${t.rebooked}`} />
        <StatTile label="No-show / Cancel Lost" value={`${t.noShowLost} / ${t.cancelledLost}`} />
        <StatTile label="MQLs" value={t.mqls} />
        <StatTile label="SQLs" value={t.sqls} />
      </StatTileRow>

      <div>
        <h2 className="mb-3 text-lg font-medium">Leaderboard</h2>
        <TeamTable rows={stats.reps} total={stats.total} />
      </div>

      {monthly && (
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

      <div>
        <h2 className="mb-1 text-lg font-medium">Needs attention</h2>
        <p className="mb-3 text-sm" style={{ color: "var(--text-muted)" }}>
          All open bookings for {group}, any month. Set <strong>Intro Meeting Status</strong> on the deal in HubSpot to
          clear them — Needs rebook stays here until it&apos;s set back to Scheduled, Held, or a Lost status.
        </p>
        <BookingsTable rows={attention} empty="Nothing waiting — every booking has a status." showDays />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-medium">Meetings booked · {periodLabel}</h2>
        <BookingsTable rows={bookings} empty="No BDR meetings booked in this period." />
      </div>
    </div>
  );
}
