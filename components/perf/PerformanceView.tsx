"use client";

import { useEffect, useMemo, useState } from "react";
import type { Booking } from "@/lib/team-queries";

// ---------------------------------------------------------------------------
// Types (all plain data — the server page computes everything)
// ---------------------------------------------------------------------------

export type Kpis = {
  meetings: number;
  bant: number;
  showRate: number | null;
  mqls: number;
  sqls: number;
  held: number;
  needsRebook: number;
  rebooked: number;
  noShowLost: number;
  cancelledLost: number;
  scheduled: number;
  outcomeMissing: number;
};

// `of` = label of an earlier stage in the same card; `ofValue` = an explicit
// base from elsewhere (e.g. Outcomes measured against Conversations).
export type Stage = { label: string; value: number; hint?: string; of?: string; ofValue?: number; ofLabel?: string; tone?: "neutral" };

export type BreakdownRow = {
  key: string;
  name: string;
  sub?: string;
  leads: number | null;
  contacted: number | null;
  dials: number;
  connects: number;
  convos: number;
  activated: number;
  meetings: number;
  bant: number;
  showRate: number | null;
  mqls: number;
  sqls: number;
  // which bookings belong to this row (drill-down)
  match?: { ownerId?: string; segmentId?: number; campaignId?: number; from?: string; to?: string };
};

type Props = {
  kpis: Kpis;
  prevKpis: Kpis | null;
  prevLabel: string | null;
  activity: { title: string; stages: Stage[] };
  outcomes: Stage[];
  table: { title: string; firstCol: string; rows: BreakdownRow[]; total: BreakdownRow | null; note?: string };
  bookings: Booking[];
  attention: Booking[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (n: number, d: number) => (d > 0 ? `${(Math.round((n / d) * 1000) / 10).toString()}%` : "—");

const STATUS: Record<string, { label: string; dot: string }> = {
  held: { label: "Held", dot: "var(--status-good)" },
  needs_rebook: { label: "Needs rebook", dot: "var(--status-warning)" },
  no_show_lost: { label: "No-show · lost", dot: "var(--status-critical)" },
  cancelled_lost: { label: "Cancelled · lost", dot: "var(--status-serious)" },
  scheduled: { label: "Scheduled", dot: "var(--accent)" },
  not_logged: { label: "Needs outcome", dot: "var(--status-warning)" },
  no_meeting: { label: "Activated", dot: "var(--neutral-mark)" },
};

function bookingMatches(b: Booking, m: BreakdownRow["match"]) {
  if (!m) return true;
  if (m.ownerId && b.ownerId !== m.ownerId) return false;
  if (m.segmentId != null && b.segmentId !== m.segmentId) return false;
  if (m.campaignId != null && b.campaignId !== m.campaignId) return false;
  if (m.from && b.bookedOn < m.from) return false;
  if (m.to && b.bookedOn > m.to) return false;
  return true;
}

// ---------------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------------

function Delta({ now, prev, unit = "", label }: { now: number | null; prev: number | null; unit?: string; label: string }) {
  if (now == null || prev == null) return <span style={{ color: "var(--text-muted)" }}>{label ? `— vs ${label}` : ""}</span>;
  const d = Math.round((now - prev) * 10) / 10;
  const color = d > 0 ? "var(--status-good)" : d < 0 ? "var(--status-critical)" : "var(--text-muted)";
  const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
  return (
    <span>
      <span style={{ color }}>
        {sign}
        {Math.abs(d)}
        {unit}
      </span>{" "}
      <span style={{ color: "var(--text-muted)" }}>vs {label}</span>
    </span>
  );
}

function Tile({
  label,
  value,
  delta,
  onClick,
  title,
  children,
}: {
  label: string;
  value: string;
  delta?: React.ReactNode;
  onClick?: () => void;
  title?: string;
  children?: React.ReactNode;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      title={title}
      className={`card flex flex-col gap-1 p-4 text-left ${onClick ? "transition hover:border-[var(--border-strong)]" : ""}`}
    >
      <span className="eyebrow">{label}</span>
      <span className="text-[28px] font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>
        {value}
      </span>
      <span className="text-xs">{delta}</span>
      {children}
    </Comp>
  );
}

// ---------------------------------------------------------------------------
// Funnel bars
// ---------------------------------------------------------------------------

const RAMP = ["var(--ramp-1)", "var(--ramp-2)", "var(--ramp-3)", "var(--ramp-4)"];

function FunnelCard({ title, stages, rampOffset = 0 }: { title: string; stages: Stage[]; rampOffset?: number }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  let rampIdx = rampOffset;
  return (
    <div className="card p-5">
      <div className="eyebrow mb-4">{title}</div>
      <div className="flex flex-col gap-3">
        {stages.map((s, i) => {
          const base =
            s.ofValue != null
              ? { value: s.ofValue, label: s.ofLabel ?? "" }
              : s.of
                ? stages.find((x) => x.label === s.of)
                : stages[i - 1];
          const color = s.tone === "neutral" ? "var(--neutral-mark)" : RAMP[Math.min(rampIdx++, RAMP.length - 1)];
          return (
            <div key={s.label} className="grid grid-cols-[110px_1fr_auto] items-center gap-3" title={s.hint}>
              <span className="truncate text-[13px]" style={{ color: "var(--text-secondary)" }}>
                {s.label}
              </span>
              <div className="h-2 rounded-full" style={{ background: "var(--surface-2)" }}>
                <div
                  className="h-2 rounded-full"
                  style={{ width: `${s.value > 0 ? Math.max(1.5, (s.value / max) * 100) : 0}%`, background: color }}
                />
              </div>
              <span className="w-[120px] text-right text-[13px]">
                <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  {fmt(s.value)}
                </span>
                {base && (
                  <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }} title={`of ${base.label}`}>
                    {pct(s.value, base.value)}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Breakdown table
// ---------------------------------------------------------------------------

const dash = <span style={{ color: "var(--text-muted)" }}>—</span>;

function RowCells({ r }: { r: BreakdownRow }) {
  return (
    <>
      <td className="hidden xl:table-cell">{r.leads == null ? dash : fmt(r.leads)}</td>
      <td className="hidden xl:table-cell">{r.leads == null || r.contacted == null ? dash : pct(r.contacted, r.leads)}</td>
      <td>{fmt(r.dials)}</td>
      <td className="hidden lg:table-cell">{fmt(r.connects)}</td>
      <td>{fmt(r.convos)}</td>
      <td className="hidden md:table-cell">{fmt(r.activated)}</td>
      <td style={{ color: "var(--text-primary)", fontWeight: 600 }}>{fmt(r.meetings)}</td>
      <td>{fmt(r.bant)}</td>
      <td>{r.showRate == null ? dash : `${r.showRate}%`}</td>
      <td>{fmt(r.mqls)}</td>
      <td>{fmt(r.sqls)}</td>
    </>
  );
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

type DrawerState =
  | { kind: "actions"; tab: "outcome" | "rebook" | "activated" }
  | { kind: "meetings" }
  | { kind: "row"; row: BreakdownRow };

function BookingList({ rows, empty, showWaiting }: { rows: Booking[]; empty: string; showWaiting?: boolean }) {
  if (rows.length === 0)
    return (
      <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        {empty}
      </p>
    );
  return (
    <ul className="divide-y" style={{ borderColor: "var(--gridline)" }}>
      {rows.map((b) => {
        const st = STATUS[b.meetingStatus] ?? { label: b.meetingStatus, dot: "var(--text-muted)" };
        return (
          <li key={b.dealId} className="flex items-start justify-between gap-4 py-3" style={{ borderColor: "var(--gridline)" }}>
            <div className="min-w-0">
              <a
                href={`https://app.hubspot.com/contacts/43446506/record/0-3/${b.dealId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-sm font-medium hover:underline"
                style={{ color: "var(--text-primary)" }}
              >
                {b.dealName.replace(/ - New Deal$/, "")}
              </a>
              <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                {b.bookedBy} · booked {b.bookedOn}
                {b.meetingOn ? ` · meeting ${b.meetingOn}` : ""}
                {b.mqlDate ? " · MQL" : ""}
                {b.sqlDate ? " · SQL" : ""}
                {b.bant ? " · BANT" : ""}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="pill" style={{ ["--dot" as string]: st.dot }}>
                {st.label}
              </span>
              {showWaiting && b.daysInStatus != null && (
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {b.daysInStatus}d waiting
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Drawer({ state, onClose, props }: { state: DrawerState; onClose: () => void; props: Props }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const needsOutcome = props.attention.filter((b) => b.meetingStatus === "not_logged");
  const needsRebook = props.attention.filter((b) => b.meetingStatus === "needs_rebook");
  const activated = props.bookings.filter((b) => b.meetingStatus === "no_meeting");

  let title = "";
  let body: React.ReactNode = null;
  if (state.kind === "actions") {
    title = "Action items";
    const tabs: { key: "outcome" | "rebook" | "activated"; label: string; n: number }[] = [
      { key: "outcome", label: "Needs outcome", n: needsOutcome.length },
      { key: "rebook", label: "Needs rebook", n: needsRebook.length },
      { key: "activated", label: "Activated leads", n: activated.length },
    ];
    body = (
      <ActionTabs
        tabs={tabs}
        initial={state.tab}
        render={(tab) =>
          tab === "outcome" ? (
            <>
              <Hint>Meeting date passed and no Intro Meeting Status is set on the deal. Set it in HubSpot to clear.</Hint>
              <BookingList rows={needsOutcome} empty="Every past meeting has an outcome." />
            </>
          ) : tab === "rebook" ? (
            <>
              <Hint>No-show or cancel, prospect still alive. Set back to Scheduled once rebooked, or to a Lost status.</Hint>
              <BookingList rows={needsRebook} empty="Nothing waiting on a rebook." showWaiting />
            </>
          ) : (
            <>
              <Hint>BDR created a deal but there&apos;s no meeting yet (this period).</Hint>
              <BookingList rows={activated} empty="No activated leads this period." />
            </>
          )
        }
      />
    );
  } else if (state.kind === "meetings") {
    title = "Deals booked this period";
    body = <BookingList rows={props.bookings} empty="No BDR deals booked in this period." />;
  } else {
    const r = state.row;
    const rows = props.bookings.filter((b) => bookingMatches(b, r.match));
    title = r.name;
    body = (
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-3">
          {[
            ["Dials", fmt(r.dials)],
            ["Conversations", fmt(r.convos)],
            ["Meetings", fmt(r.meetings)],
            ["Activated", fmt(r.activated)],
            ["BANT", fmt(r.bant)],
            ["Show rate", r.showRate == null ? "—" : `${r.showRate}%`],
            ["MQL", fmt(r.mqls)],
            ["SQL", fmt(r.sqls)],
            ["Contacted", r.leads == null || r.contacted == null ? "—" : `${fmt(r.contacted)} / ${fmt(r.leads)}`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg p-3" style={{ background: "var(--surface-2)" }}>
              <div className="eyebrow">{k}</div>
              <div className="mt-1 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                {v}
              </div>
            </div>
          ))}
        </div>
        <div>
          <div className="eyebrow mb-2">Deals</div>
          <BookingList rows={rows} empty="No BDR deals for this row." />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 cursor-default" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose} aria-label="Close" />
      <aside
        className="relative flex h-full w-full max-w-xl flex-col"
        style={{ background: "var(--surface)", borderLeft: "1px solid var(--border-hairline)", animation: "drawer-in 160ms ease-out" }}
      >
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border-hairline)" }}>
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {title}
          </h2>
          <button onClick={onClose} className="btn px-2 py-1" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{body}</div>
      </aside>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-xs" style={{ color: "var(--text-muted)" }}>
      {children}
    </p>
  );
}

function ActionTabs<K extends string>({
  tabs,
  initial,
  render,
}: {
  tabs: { key: K; label: string; n: number }[];
  initial: K;
  render: (k: K) => React.ReactNode;
}) {
  const [tab, setTab] = useState<K>(initial);
  return (
    <div>
      <div className="seg mb-4">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} aria-current={tab === t.key}>
            {t.label} <span style={{ color: "var(--text-muted)" }}>{t.n}</span>
          </button>
        ))}
      </div>
      {render(tab)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function PerformanceView(props: Props) {
  const { kpis: k, prevKpis: p, prevLabel } = props;
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const needsOutcome = useMemo(() => props.attention.filter((b) => b.meetingStatus === "not_logged").length, [props.attention]);
  const needsRebook = useMemo(() => props.attention.filter((b) => b.meetingStatus === "needs_rebook").length, [props.attention]);
  const deltaLabel = prevLabel ?? "";

  return (
    <div className="space-y-6">
      {(needsOutcome > 0 || needsRebook > 0) && (
        <button
          onClick={() => setDrawer({ kind: "actions", tab: needsOutcome > 0 ? "outcome" : "rebook" })}
          className="card flex w-full items-center justify-between px-4 py-3 text-left text-sm transition hover:border-[var(--border-strong)]"
        >
          <span className="flex items-center gap-3">
            <span className="pill" style={{ ["--dot" as string]: "var(--status-warning)" }}>
              Action items
            </span>
            <span style={{ color: "var(--text-secondary)" }}>
              {needsOutcome > 0 && `${needsOutcome} meeting${needsOutcome === 1 ? "" : "s"} need an outcome`}
              {needsOutcome > 0 && needsRebook > 0 && " · "}
              {needsRebook > 0 && `${needsRebook} to rebook`}
            </span>
          </span>
          <span style={{ color: "var(--text-muted)" }}>Review →</span>
        </button>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Tile
          label="Meetings"
          value={fmt(k.meetings)}
          delta={p && <Delta now={k.meetings} prev={p.meetings} label={deltaLabel} />}
          onClick={() => setDrawer({ kind: "meetings" })}
          title="BDR-sourced meetings booked — click for the list"
        />
        <Tile label="BANT meetings" value={fmt(k.bant)} delta={p && <Delta now={k.bant} prev={p.bant} label={deltaLabel} />} />
        <Tile
          label="Show rate"
          value={k.showRate == null ? "—" : `${k.showRate}%`}
          delta={p && <Delta now={k.showRate} prev={p.showRate} unit=" pts" label={deltaLabel} />}
          onClick={() => setDrawer({ kind: "actions", tab: "rebook" })}
          title={`Held ${k.held} · Needs rebook ${k.needsRebook} · Rebooked ${k.rebooked} · No-show lost ${k.noShowLost} · Cancelled lost ${k.cancelledLost} · Scheduled ${k.scheduled}`}
        >
          <span className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {k.held} held · {k.needsRebook} rebook · {k.noShowLost + k.cancelledLost} lost
          </span>
        </Tile>
        <Tile label="MQL" value={fmt(k.mqls)} delta={p && <Delta now={k.mqls} prev={p.mqls} label={deltaLabel} />} />
        <Tile label="SQL" value={fmt(k.sqls)} delta={p && <Delta now={k.sqls} prev={p.sqls} label={deltaLabel} />} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FunnelCard title={props.activity.title} stages={props.activity.stages} />
        <FunnelCard title="Outcomes" stages={props.outcomes} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-baseline justify-between px-5 pt-4 pb-2">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {props.table.title}
          </h2>
          {props.table.note && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {props.table.note}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{props.table.firstCol}</th>
                <th className="hidden xl:table-cell">Leads</th>
                <th className="hidden xl:table-cell" title="Leads with at least one call">Contacted</th>
                <th>Dials</th>
                <th className="hidden lg:table-cell">Connects</th>
                <th title="Pitch / Past Pitch / Meeting outcomes">Convos</th>
                <th className="hidden md:table-cell" title="Deal created, no meeting">Activated</th>
                <th>Meetings</th>
                <th>BANT</th>
                <th title="Held ÷ (held + needs rebook + lost)">Show</th>
                <th title="Entered Pre-Assessment / System Overview">MQL</th>
                <th title="Entered the Sales Pipeline">SQL</th>
              </tr>
            </thead>
            <tbody>
              {props.table.rows.length === 0 && (
                <tr>
                  <td colSpan={12} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                    Nothing here for this period.
                  </td>
                </tr>
              )}
              {props.table.rows.map((r) => (
                <tr key={r.key} className="clickable" onClick={() => setDrawer({ kind: "row", row: r })}>
                  <td>
                    <div className="font-medium" style={{ color: "var(--text-primary)" }}>
                      {r.name}
                    </div>
                    {r.sub && (
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {r.sub}
                      </div>
                    )}
                  </td>
                  <RowCells r={r} />
                </tr>
              ))}
            </tbody>
            {props.table.total && props.table.rows.length > 1 && (
              <tfoot>
                <tr>
                  <td>{props.table.total.name}</td>
                  <RowCells r={props.table.total} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {drawer && <Drawer state={drawer} onClose={() => setDrawer(null)} props={props} />}
    </div>
  );
}
