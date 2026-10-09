"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActivatedLead, Booking, IntroAttempt } from "@/lib/team-queries";

// ---------------------------------------------------------------------------
// Types (all plain data — the server page computes everything)
// ---------------------------------------------------------------------------

export type Kpis = {
  meetings: number; // meetings set
  sat: number;
  showRate: number | null;
  bant: number;
  mqls: number;
  sqls: number;
  noShows: number;
  cancels: number;
  // what became of the period's no-shows / cancels
  needsRebook: number;
  rebooked: number;
  lost: number;
  outcomeMissing: number;
  scheduled: number;
};

// `of` = label of an earlier stage in the same card; `ofValue` = an explicit
// base from elsewhere (e.g. Outcomes measured against Conversations);
// `noBase` = no percentage (the stages aren't the same group of deals).
export type Stage = {
  label: string;
  value: number;
  hint?: string;
  of?: string;
  ofValue?: number;
  ofLabel?: string;
  noBase?: boolean;
  tone?: "neutral";
};

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
  sat: number;
  bant: number;
  showRate: number | null;
  mqls: number;
  sqls: number;
  // clicking the row navigates here (rep / campaign focus) instead of the drill-down
  href?: string;
  // which bookings belong to this row (drill-down)
  match?: { ownerId?: string; segmentId?: number; campaignId?: number; from?: string; to?: string };
};

type Props = {
  kpis: Kpis;
  prevKpis: Kpis | null;
  prevLabel: string | null;
  activity: { title: string; stages: Stage[] };
  outcomes: Stage[];
  table: {
    title: string;
    firstCol: string;
    rows: BreakdownRow[];
    total: BreakdownRow | null;
    note?: string;
    defaultSort?: { key: string; dir: "asc" | "desc" };
  };
  bookings: Booking[];
  attempts: IntroAttempt[];
  attention: Booking[];
  activatedLeads: ActivatedLead[]; // activated in this period
  range: { startDate: string; endDate: string };
  cohort: boolean;
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
          const base = s.noBase
            ? null
            : s.ofValue != null
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
      <td className="key">{fmt(r.meetings)}</td>
      <td className="key">{fmt(r.sat)}</td>
      <td className="key">{fmt(r.bant)}</td>
      <td>{r.showRate == null ? dash : `${r.showRate}%`}</td>
      <td className="key">{fmt(r.mqls)}</td>
      <td className="key">{fmt(r.sqls)}</td>
    </>
  );
}

const COLUMNS: { key: string; label: string; cls?: string; title?: string; isKey?: boolean }[] = [
  { key: "name", label: "" },
  { key: "leads", label: "Leads", cls: "hidden xl:table-cell" },
  { key: "contacted", label: "Contacted", cls: "hidden xl:table-cell", title: "Leads with at least one call" },
  { key: "dials", label: "Dials" },
  { key: "connects", label: "Connects", cls: "hidden lg:table-cell" },
  { key: "convos", label: "Convos", title: "Pitch / Past Pitch / Meeting outcomes" },
  { key: "activated", label: "Activated", cls: "hidden md:table-cell", title: "Contact set to Open Deal, no deal yet" },
  { key: "meetings", label: "Set", isKey: true, title: "Meetings set (booked)" },
  { key: "sat", label: "Sat", isKey: true, title: "Intro meetings that happened" },
  { key: "bant", label: "BANT", isKey: true },
  { key: "showRate", label: "Show", title: "Sat ÷ (sat + no-show + canceled)" },
  { key: "mqls", label: "MQL", isKey: true, title: "Entered Pre-Assessment / System Overview" },
  { key: "sqls", label: "SQL", isKey: true, title: "Entered the Sales Pipeline" },
];

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

type ActionTab = "outcome" | "rebook" | "check" | "activated";
type ShowTab = "sat" | "rebook" | "rebooked" | "lost" | "open";

const RESULT: Record<string, string> = {
  sat: "Sat",
  no_show: "No-show",
  canceled: "Canceled",
  rescheduled: "Moved",
  scheduled: "Upcoming",
  not_logged: "Needs outcome",
};

function missState(a: IntroAttempt): "rebook" | "rebooked" | "lost" | null {
  if (a.result !== "no_show" && a.result !== "canceled") return null;
  if (a.rebooked) return "rebooked";
  if (a.dealStatus === "needs_rebook") return "rebook";
  if (a.dealStatus === "no_show_lost" || a.dealStatus === "cancelled_lost") return "lost";
  return "rebooked";
}

function AttemptList({ rows, empty }: { rows: IntroAttempt[]; empty: string }) {
  if (rows.length === 0)
    return (
      <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        {empty}
      </p>
    );
  return (
    <ul className="divide-y" style={{ borderColor: "var(--gridline)" }}>
      {rows.map((a) => {
        const miss = missState(a);
        const dot =
          a.result === "sat"
            ? "var(--status-good)"
            : miss === "lost"
              ? "var(--status-critical)"
              : miss === "rebook" || a.result === "not_logged"
                ? "var(--status-warning)"
                : "var(--text-muted)";
        return (
          <li key={`${a.dealId}-${a.meetingOn}`} className="flex items-start justify-between gap-4 py-3" style={{ borderColor: "var(--gridline)" }}>
            <div className="min-w-0">
              <a
                href={`https://app.hubspot.com/contacts/43446506/record/0-3/${a.dealId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-sm font-medium hover:underline"
                style={{ color: "var(--text-primary)" }}
              >
                {a.dealName.replace(/ - New Deal$/, "")}
              </a>
              <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                {a.bookedBy} · booked {a.bookedOn} · meeting {a.meetingOn}
              </div>
            </div>
            <span className="pill shrink-0" style={{ ["--dot" as string]: dot }}>
              {RESULT[a.result] ?? a.result}
              {miss === "rebook" ? " · needs rebook" : miss === "rebooked" ? " · rebooked" : miss === "lost" ? " · lost" : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const FLAG: Record<string, string> = {
  completed_not_recorded: "Marked Completed, but no recording",
  no_show_but_recorded: "Marked No-show / Canceled, but it was recorded",
};

type StageKey = "bant" | "mql" | "sql";
const STAGE_INFO: Record<StageKey, { title: string; date: (b: Booking) => string | null; hint: string }> = {
  bant: { title: "BANT", date: (b) => b.bantDate, hint: "BANT box ticked on the deal" },
  mql: { title: "MQL", date: (b) => b.mqlDate, hint: "Deal entered Pre-Assessment / System Overview (or went straight to Sales)" },
  sql: { title: "SQL", date: (b) => b.sqlDate, hint: "Deal entered the Sales Pipeline" },
};

export function ActivatedList({ rows, empty, showRep = true }: { rows: ActivatedLead[]; empty: string; showRep?: boolean }) {
  if (rows.length === 0)
    return (
      <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        {empty}
      </p>
    );
  return (
    <ul className="divide-y" style={{ borderColor: "var(--gridline)" }}>
      {rows.map((a) => (
        <li key={a.contactId} className="flex items-start justify-between gap-4 py-3" style={{ borderColor: "var(--gridline)" }}>
          <div className="min-w-0">
            <a
              href={`https://app.hubspot.com/contacts/43446506/record/0-1/${a.contactId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-sm font-medium hover:underline"
              style={{ color: "var(--text-primary)" }}
            >
              {a.companyName ?? a.contactName}
            </a>
            <div className="mt-0.5 truncate text-xs" style={{ color: "var(--text-muted)" }}>
              {a.contactName}
              {a.jobTitle ? ` · ${a.jobTitle}` : ""}
              {showRep ? ` · ${a.rep}` : ""} · activated {a.activatedOn}
            </div>
          </div>
          <span
            className="pill shrink-0"
            style={{ ["--dot" as string]: a.daysWaiting >= 7 ? "var(--status-warning)" : "var(--accent)" }}
          >
            {a.daysWaiting === 0 ? "today" : `${a.daysWaiting}d`}
          </span>
        </li>
      ))}
    </ul>
  );
}

type DrawerState =
  | { kind: "stage"; stage: StageKey }
  | { kind: "actions"; tab: ActionTab }
  | { kind: "meetings" }
  | { kind: "shows"; tab: ShowTab }
  | { kind: "row"; row: BreakdownRow };

const EVIDENCE_TITLE: Record<string, string> = {
  recorded: "HubSpot's notetaker recorded the meeting",
  outcome: "Meeting outcome set to Completed in HubSpot (no recording)",
  stage: "No recording or outcome, but the deal moved to Pre-Assessment or Sales",
};

export function BookingList({ rows, empty, showWaiting }: { rows: Booking[]; empty: string; showWaiting?: boolean }) {
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
              {b.checkFlag && (
                <div className="mt-1 text-xs" style={{ color: "var(--status-warning)" }}>
                  ⚠ {FLAG[b.checkFlag] ?? b.checkFlag}
                </div>
              )}
              {b.summary && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-xs" style={{ color: "var(--accent)" }}>
                    Meeting summary
                  </summary>
                  <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    {b.summary}
                  </p>
                </details>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="pill" style={{ ["--dot" as string]: st.dot }}>
                {st.label}
              </span>
              {b.meetingStatus === "held" && (
                <span className="text-xs" style={{ color: "var(--text-muted)" }} title={EVIDENCE_TITLE[b.statusSource]}>
                  {b.statusSource === "recorded"
                    ? `✓ Recorded${b.recordingMinutes ? ` ${b.recordingMinutes}m` : ""}`
                    : b.statusSource === "outcome"
                      ? "Outcome: Completed"
                      : b.statusSource === "stage"
                        ? "Deal moved on"
                        : ""}
                </span>
              )}
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
  const toCheck = props.attention.filter((b) => b.checkFlag);
  const activated = props.activatedLeads;

  let title = "";
  let body: React.ReactNode = null;
  if (state.kind === "actions") {
    title = "Action items";
    const tabs: { key: ActionTab; label: string; n: number }[] = [
      { key: "outcome", label: "Needs outcome", n: needsOutcome.length },
      { key: "rebook", label: "Needs rebook", n: needsRebook.length },
      { key: "check", label: "Check", n: toCheck.length },
      { key: "activated", label: "Activated leads", n: activated.length },
    ];
    body = (
      <ActionTabs
        tabs={tabs}
        initial={state.tab}
        render={(tab) =>
          tab === "outcome" ? (
            <>
              <Hint>
                Meeting date passed, it wasn&apos;t recorded, and the meeting has no outcome. Set the meeting outcome
                (Completed / No show / Canceled) in HubSpot to clear.
              </Hint>
              <BookingList rows={needsOutcome} empty="Every past meeting has an outcome." />
            </>
          ) : tab === "rebook" ? (
            <>
              <Hint>
                Meeting marked No show / Canceled / Rescheduled and the deal is still open. Book a new meeting to clear it,
                or close the deal lost.
              </Hint>
              <BookingList rows={needsRebook} empty="Nothing waiting on a rebook." showWaiting />
            </>
          ) : tab === "check" ? (
            <>
              <Hint>
                The meeting outcome and HubSpot&apos;s recording disagree. A recording wins (counted as held); fix the
                outcome in HubSpot to clear.
              </Hint>
              <BookingList rows={toCheck} empty="Every outcome matches the recordings." />
            </>
          ) : (
            <>
              <Hint>
                Contact set to Lead Status &ldquo;Open Deal&rdquo; this period, with no deal yet. Book the meeting (create
                the deal) to clear it.
              </Hint>
              <ActivatedList rows={activated} empty="No activated leads this period." />
            </>
          )
        }
      />
    );
  } else if (state.kind === "stage") {
    const info = STAGE_INFO[state.stage];
    const inPeriod = (d: string | null) => d != null && d >= props.range.startDate && d <= props.range.endDate;
    const rows = props.bookings
      .filter((b) => (props.cohort ? info.date(b) != null : inPeriod(info.date(b))))
      .sort((a, b) => (info.date(b) ?? "").localeCompare(info.date(a) ?? ""));
    title = `${info.title} · ${rows.length}`;
    body = (
      <>
        <Hint>
          {info.hint}.{" "}
          {props.cohort ? "Of the meetings set in this period, whenever it happened." : "Happened in this period, whenever the meeting was booked."}
        </Hint>
        <BookingList rows={rows} empty={`No ${info.title} in this period.`} />
      </>
    );
  } else if (state.kind === "meetings") {
    title = props.cohort ? "Meetings set this period" : "Deals this period";
    body = (
      <>
        <Hint>
          {props.cohort
            ? "Every deal booked in this period, with what has happened to it since."
            : "Booked in this period, plus earlier bookings that sat, became BANT, MQL or SQL in it."}
        </Hint>
        <BookingList rows={props.bookings} empty="No BDR deals in this period." />
      </>
    );
  } else if (state.kind === "shows") {
    title = props.cohort ? "Intro meetings of this period's bookings" : "Intro meetings this period";
    const at = props.attempts;
    const sat = at.filter((a) => a.result === "sat");
    const rebook = at.filter((a) => missState(a) === "rebook");
    const rebooked = at.filter((a) => missState(a) === "rebooked");
    const lost = at.filter((a) => missState(a) === "lost");
    const open = at.filter((a) => a.result === "not_logged" || a.result === "scheduled" || a.result === "rescheduled");
    const tabs: { key: ShowTab; label: string; n: number }[] = [
      { key: "sat", label: "Sat", n: sat.length },
      { key: "rebook", label: "Needs rebook", n: rebook.length },
      { key: "rebooked", label: "Rebooked", n: rebooked.length },
      { key: "lost", label: "Lost", n: lost.length },
      { key: "open", label: "Other", n: open.length },
    ];
    body = (
      <>
        <Hint>
          Show rate = sat ÷ (sat + no-shows + cancels). A no-show stays a no-show after it&apos;s rebooked; a meeting moved
          before it happened doesn&apos;t count either way.
        </Hint>
        <ActionTabs
          tabs={tabs}
          initial={state.tab}
          render={(tab) =>
            tab === "sat" ? (
              <AttemptList rows={sat} empty="No intro meetings sat in this period." />
            ) : tab === "rebook" ? (
              <>
                <Hint>No-show or cancel, company still open. Book a new meeting (or set the outcome to Rescheduled once rebooked).</Hint>
                <AttemptList rows={rebook} empty="Nothing waiting on a rebook." />
              </>
            ) : tab === "rebooked" ? (
              <AttemptList rows={rebooked} empty="No rebooked meetings." />
            ) : tab === "lost" ? (
              <>
                <Hint>No-show or cancel where the company is marked Not Interested or the deal is closed lost.</Hint>
                <AttemptList rows={lost} empty="Nothing lost." />
              </>
            ) : (
              <>
                <Hint>Upcoming, moved before they happened, or past with no outcome yet — not in the show rate.</Hint>
                <AttemptList rows={open} empty="Nothing else." />
              </>
            )
          }
        />
      </>
    );
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
            ["Meetings set", fmt(r.meetings)],
            ["Sat", fmt(r.sat)],
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
  const router = useRouter();
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  // Leaderboard-style tables (reps / campaigns / segments) sort; time tables stay chronological.
  const sortable = Boolean(props.table.defaultSort);
  const sortResetKey = `${props.table.title}|${props.table.defaultSort?.key ?? ""}`;
  const [sortState, setSortState] = useState({ resetKey: sortResetKey, sort: props.table.defaultSort ?? null });
  const sort = sortState.resetKey === sortResetKey ? sortState.sort : (props.table.defaultSort ?? null);
  const toggleSort = (key: string) =>
    setSortState({
      resetKey: sortResetKey,
      sort: sort?.key === key ? { key, dir: sort.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "name" ? "asc" : "desc" },
    });
  const rows = useMemo(() => {
    if (!sort) return props.table.rows;
    const val = (r: BreakdownRow): number | string => {
      if (sort.key === "name") return r.name.toLowerCase();
      if (sort.key === "contacted") return r.leads && r.contacted != null ? r.contacted / r.leads : -1;
      const v = r[sort.key as keyof BreakdownRow];
      return typeof v === "number" ? v : -1;
    };
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...props.table.rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x < y) return -dir;
      if (x > y) return dir;
      // ties: meetings, then dials, so the order is stable and meaningful
      return b.meetings - a.meetings || b.dials - a.dials;
    });
  }, [props.table.rows, sort]);
  const needsOutcome = useMemo(() => props.attention.filter((b) => b.meetingStatus === "not_logged").length, [props.attention]);
  const needsRebook = useMemo(() => props.attention.filter((b) => b.meetingStatus === "needs_rebook").length, [props.attention]);
  const toCheck = useMemo(() => props.attention.filter((b) => b.checkFlag).length, [props.attention]);
  const deltaLabel = prevLabel ?? "";

  return (
    <div className="space-y-6">
      {(needsOutcome > 0 || needsRebook > 0 || toCheck > 0) && (
        <button
          onClick={() =>
            setDrawer({ kind: "actions", tab: needsOutcome > 0 ? "outcome" : needsRebook > 0 ? "rebook" : "check" })
          }
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
              {(needsOutcome > 0 || needsRebook > 0) && toCheck > 0 && " · "}
              {toCheck > 0 && `${toCheck} to check`}
            </span>
          </span>
          <span style={{ color: "var(--text-muted)" }}>Review →</span>
        </button>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Tile
          label="Meetings set"
          value={fmt(k.meetings)}
          delta={p && <Delta now={k.meetings} prev={p.meetings} label={deltaLabel} />}
          onClick={() => setDrawer({ kind: "meetings" })}
          title="BDR-sourced meetings booked in this period — click for the list"
        />
        <Tile
          label="Meetings sat"
          value={fmt(k.sat)}
          delta={p && <Delta now={k.sat} prev={p.sat} label={deltaLabel} />}
          onClick={() => setDrawer({ kind: "shows", tab: "sat" })}
          title={
            props.cohort
              ? "Of the meetings set in this period, how many intros happened"
              : "Intro meetings that happened in this period, whenever they were booked"
          }
        />
        <Tile
          label="Show rate"
          value={k.showRate == null ? "—" : `${k.showRate}%`}
          delta={p && <Delta now={k.showRate} prev={p.showRate} unit=" pts" label={deltaLabel} />}
          onClick={() => setDrawer({ kind: "shows", tab: k.needsRebook > 0 ? "rebook" : "sat" })}
          title={`Sat ${k.sat} · No-show ${k.noShows} · Canceled ${k.cancels} — of the misses: ${k.needsRebook} need rebook, ${k.rebooked} rebooked, ${k.lost} lost`}
        >
          <span className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {k.needsRebook} rebook · {k.rebooked} rebooked · {k.lost} lost
          </span>
        </Tile>
        <Tile
          label="BANT"
          value={fmt(k.bant)}
          delta={p && <Delta now={k.bant} prev={p.bant} label={deltaLabel} />}
          onClick={() => setDrawer({ kind: "stage", stage: "bant" })}
          title="Click for the BANT meetings"
        />
        <Tile
          label="MQL"
          value={fmt(k.mqls)}
          delta={p && <Delta now={k.mqls} prev={p.mqls} label={deltaLabel} />}
          onClick={() => setDrawer({ kind: "stage", stage: "mql" })}
          title="Click for the MQLs"
        />
        <Tile
          label="SQL"
          value={fmt(k.sqls)}
          delta={p && <Delta now={k.sqls} prev={p.sqls} label={deltaLabel} />}
          onClick={() => setDrawer({ kind: "stage", stage: "sql" })}
          title="Click for the SQLs"
        />
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
                {COLUMNS.map((c) => {
                  const active = sort?.key === c.key;
                  return (
                    <th
                      key={c.key}
                      className={[c.cls, c.isKey ? "key" : "", sortable ? "sortable" : ""].filter(Boolean).join(" ")}
                      title={c.title}
                      onClick={sortable ? () => toggleSort(c.key) : undefined}
                      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                    >
                      {c.key === "name" ? props.table.firstCol : c.label}
                      {active && <span style={{ color: "var(--accent)" }}>{sort!.dir === "asc" ? " ↑" : " ↓"}</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                    Nothing here for this period.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className="clickable"
                  onClick={() => (r.href ? router.push(r.href) : setDrawer({ kind: "row", row: r }))}
                >
                  <td>
                    <div className="font-medium" style={{ color: r.href ? "var(--accent)" : "var(--text-primary)" }}>
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
            {props.table.total && rows.length > 1 && (
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
