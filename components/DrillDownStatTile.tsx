"use client";

import { useState, useTransition } from "react";
import { fetchDrillDown } from "@/app/(dashboard)/drilldown-actions";
import { DailyCallsChart } from "@/components/DailyCallsChart";
import type { DrillDownMetric } from "@/lib/queries";

type DrillDownResult = Awaited<ReturnType<typeof fetchDrillDown>>;
type ContactRow = DrillDownResult["rows"][number];
type DailyStats = DrillDownResult["dailyStats"];

const METRIC_TITLES: Record<DrillDownMetric, string> = {
  enrolled: "Contacts Enrolled",
  calls: "Calls Made",
  connects: "Connects",
  replies: "Replies",
  meetings: "Meetings Booked",
};

// Pinned to Toronto (the team's timezone) rather than relying on the
// viewer's own device — this runs client-side, so left to the browser
// default it would only be correct for a viewer whose device happens to be
// set to Eastern time too.
function formatTorontoTime(iso: string | Date) {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Toronto" });
}

export function DrillDownStatTile({
  label,
  value,
  metric,
  campaignId,
}: {
  label: string;
  value: string | number;
  metric: DrillDownMetric;
  campaignId?: number;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ContactRow[] | null>(null);
  const [outcomeCounts, setOutcomeCounts] = useState<Record<string, number>>({});
  const [dailyStats, setDailyStats] = useState<DailyStats>(null);
  const [isPending, startTransition] = useTransition();

  const showDailyChart = metric === "calls" || metric === "connects";

  function handleOpen() {
    setOpen(true);
    startTransition(async () => {
      const data = await fetchDrillDown(metric, campaignId);
      setRows(data.rows);
      setOutcomeCounts(data.outcomeCounts);
      setDailyStats(data.dailyStats);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="hud-panel group cursor-pointer p-4 text-left transition hover:brightness-125"
      >
        <div className="hud-heading flex items-center justify-between text-xs">
          {label}
          <span
            className="opacity-0 transition group-hover:opacity-100"
            style={{ color: "var(--series-blue)" }}
          >
            View →
          </span>
        </div>
        <div
          className="mt-1 text-3xl font-semibold tabular-nums"
          style={{ color: "var(--text-primary)" }}
        >
          {value}
        </div>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className={`hud-panel max-h-[80vh] w-full ${showDailyChart ? "max-w-3xl" : "max-w-2xl"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex max-h-[80vh] flex-col overflow-hidden rounded-lg">
            <div
              className="flex items-center justify-between border-b px-5 py-4"
              style={{ borderColor: "var(--gridline)" }}
            >
              <h3 className="hud-heading text-base" style={{ color: "var(--text-primary)" }}>
                {METRIC_TITLES[metric]}
                {rows && metric === "calls"
                  ? ` (${rows.length} contacts, ${rows.reduce((sum, r) => sum + (r.callCount ?? 0), 0)} calls)`
                  : rows
                    ? ` (${rows.length})`
                    : ""}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="hud-button rounded px-2 py-1 text-xs"
              >
                Close
              </button>
            </div>

            {metric === "replies" && (
              <p
                className="border-b px-5 py-2 text-xs"
                style={{ borderColor: "var(--gridline)", color: "var(--text-muted)" }}
              >
                Email vs. call is inferred, not a field HubSpot reports directly: connected by call
                in this window → counted as a call reply, otherwise → email reply.
              </p>
            )}

            {showDailyChart && dailyStats && (
              <DailyCallsChart data={dailyStats} mode={metric === "connects" ? "connects" : "calls"} />
            )}

            {Object.keys(outcomeCounts).length > 1 && (
              <div
                className="flex flex-wrap gap-2 border-b px-5 py-3"
                style={{ borderColor: "var(--gridline)" }}
              >
                {Object.entries(outcomeCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([label, count]) => (
                    <span
                      key={label}
                      className="rounded-full border px-2.5 py-1 text-xs"
                      style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}
                    >
                      {label}: <span style={{ color: "var(--text-primary)" }}>{count}</span>
                    </span>
                  ))}
              </div>
            )}

            <div className="max-h-[60vh] overflow-y-auto">
              {isPending && !rows && (
                <p className="px-5 py-6 text-sm" style={{ color: "var(--text-muted)" }}>
                  Loading…
                </p>
              )}
              {rows && rows.length === 0 && (
                <p className="px-5 py-6 text-sm" style={{ color: "var(--text-muted)" }}>
                  No contacts.
                </p>
              )}
              {rows && rows.length > 0 && (
                <ul>
                  {rows.map((r) => (
                    <li
                      key={r.hubspotContactId}
                      className="border-b px-5 py-3 text-sm last:border-b-0"
                      style={{ borderColor: "var(--gridline)" }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <a
                          href={r.hubspotUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium hover:underline"
                          style={{ color: "var(--series-blue)" }}
                        >
                          {r.name}
                        </a>
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.ownerName}
                        </span>
                      </div>
                      <div className="mt-0.5" style={{ color: "var(--text-secondary)" }}>
                        {[r.jobTitle, r.companyName].filter(Boolean).join(" · ") || "—"}
                      </div>
                      {(metric === "calls" || metric === "connects") && (
                        <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                          {metric === "calls" && r.callCount != null
                            ? `${r.callCount} call${r.callCount === 1 ? "" : "s"} · `
                            : ""}
                          {r.dispositionLabel ?? "No disposition logged"}
                          {r.lastCallAt ? ` · ${formatTorontoTime(r.lastCallAt)}` : ""}
                        </div>
                      )}
                      {metric === "replies" && r.replyChannel && (
                        <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.replyChannel}
                          {r.replyChannel === "Call reply" && r.dispositionLabel
                            ? ` · ${r.dispositionLabel}`
                            : ""}
                          {r.lastCallAt ? ` · ${formatTorontoTime(r.lastCallAt)}` : ""}
                        </div>
                      )}
                      {metric === "meetings" && r.lastMeetingAt && (
                        <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                          {formatTorontoTime(r.lastMeetingAt)}
                        </div>
                      )}
                      {metric === "enrolled" && r.leadStatus && (
                        <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                          Lead status: {r.leadStatus}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
