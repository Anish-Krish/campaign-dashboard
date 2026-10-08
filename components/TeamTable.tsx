"use client";

import { useState } from "react";
import type { TeamStatRow } from "@/lib/team-queries";

type Col = {
  key: keyof TeamStatRow;
  label: string;
  title?: string;
  format?: (r: TeamStatRow) => string;
};

const COLUMNS: Col[] = [
  { key: "dials", label: "Dials" },
  { key: "connects", label: "Connects" },
  { key: "connectRate", label: "Connect %", format: (r) => `${r.connectRate}%` },
  { key: "conversations", label: "Convos", title: "Pitch / Past Pitch / Meeting dispositions" },
  { key: "activated", label: "Activated", title: "BDR created a deal but no meeting (Future Prospects)" },
  { key: "meetingsBooked", label: "Meetings", title: "BDR-sourced meetings booked (marketing, Sage and referral leads excluded)" },
  { key: "bant", label: "BANT", title: "Bookings marked BANT Qualified on the deal" },
  { key: "held", label: "Held" },
  { key: "needsRebook", label: "Needs rebook", title: "No-show or cancel, prospect still alive" },
  { key: "rebooked", label: "Rebooked", title: "Went to Needs Rebook (or no-show/cancel) and got a new meeting" },
  { key: "noShowLost", label: "No-show lost" },
  { key: "cancelledLost", label: "Cancel lost" },
  {
    key: "showRate",
    label: "Show %",
    title: "Held ÷ (held + needs rebook + no-show lost + cancel lost)",
    format: (r) => (r.showRate == null ? "—" : `${r.showRate}%`),
  },
  {
    key: "outcomeMissing",
    label: "Needs status",
    title: "Meeting passed with no Intro Meeting Status set — not counted in Show %",
  },
  { key: "mqls", label: "MQL", title: "Entered Pre-Assessment / System Overview in this period" },
  { key: "sqls", label: "SQL", title: "Entered the Sales Pipeline in this period" },
];

// Sortable leaderboard — doubles as the competition view when a trial-rep
// group is selected. Default sort is meetings booked, the BDR's core output.
export function TeamTable({
  rows,
  total,
  firstColumnLabel = "Rep",
  sortable = true,
  showRank = true,
}: {
  rows: TeamStatRow[];
  total?: TeamStatRow;
  firstColumnLabel?: string;
  sortable?: boolean;
  showRank?: boolean;
}) {
  const [sortKey, setSortKey] = useState<keyof TeamStatRow>("meetingsBooked");
  const sorted = sortable
    ? [...rows].sort((a, b) => Number(b[sortKey] ?? -1) - Number(a[sortKey] ?? -1))
    : rows;

  const cell = (r: TeamStatRow, c: Col) => (c.format ? c.format(r) : String(r[c.key]));

  return (
    <div className="hud-panel">
      <div className="overflow-x-auto rounded-lg">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="hud-heading border-b text-xs" style={{ borderColor: "var(--border-hairline)" }}>
              {showRank && <th className="px-3 py-3 font-medium">#</th>}
              <th className="px-3 py-3 font-medium">{firstColumnLabel}</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  title={c.title}
                  onClick={sortable ? () => setSortKey(c.key) : undefined}
                  className={`whitespace-nowrap px-3 py-3 text-right font-medium ${sortable ? "cursor-pointer select-none hover:text-[var(--series-blue)]" : ""}`}
                  style={sortable && sortKey === c.key ? { color: "var(--series-blue)" } : undefined}
                >
                  {c.label}
                  {sortable && sortKey === c.key ? " ↓" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 2} className="px-4 py-6 text-center" style={{ color: "var(--text-muted)" }}>
                  No one in this group yet — add reps in Settings.
                </td>
              </tr>
            )}
            {sorted.map((r, i) => (
              <tr key={r.ownerId} className="border-t" style={{ borderColor: "var(--gridline)" }}>
                {showRank && (
                  <td className="px-3 py-3 tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {i + 1}
                  </td>
                )}
                <td className="whitespace-nowrap px-3 py-3" style={{ color: "var(--text-primary)" }}>
                  {r.name}
                </td>
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    className="px-3 py-3 text-right tabular-nums"
                    style={
                      c.key === "outcomeMissing" && r.outcomeMissing > 0
                        ? { color: "var(--status-warning)" }
                        : { color: "var(--text-secondary)" }
                    }
                  >
                    {cell(r, c)}
                  </td>
                ))}
              </tr>
            ))}
            {total && sorted.length > 1 && (
              <tr className="border-t-2 font-medium" style={{ borderColor: "var(--border-hairline)" }}>
                {showRank && <td />}
                <td className="px-3 py-3" style={{ color: "var(--text-primary)" }}>
                  {total.name}
                </td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className="px-3 py-3 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {cell(total, c)}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
