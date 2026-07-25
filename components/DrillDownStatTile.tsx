"use client";

import { useState, useTransition } from "react";
import { fetchDrillDown } from "@/app/(dashboard)/drilldown-actions";
import type { DrillDownMetric } from "@/lib/queries";

type DrillDownResult = Awaited<ReturnType<typeof fetchDrillDown>>;
type ContactRow = DrillDownResult["rows"][number];

const METRIC_TITLES: Record<DrillDownMetric, string> = {
  enrolled: "Contacts Enrolled",
  calls: "Calls Made",
  connects: "Connects",
  replies: "Replies",
  meetings: "Meetings Booked",
};

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
  const [isPending, startTransition] = useTransition();

  function handleOpen() {
    setOpen(true);
    startTransition(async () => {
      const data = await fetchDrillDown(metric, campaignId);
      setRows(data.rows);
      setOutcomeCounts(data.outcomeCounts);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="group cursor-pointer rounded-lg border p-4 text-left transition hover:border-[var(--series-blue)] hover:brightness-110"
        style={{ background: "var(--chart-surface)", borderColor: "var(--border-hairline)" }}
      >
        <div
          className="flex items-center justify-between text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
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
            className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-lg border"
            style={{ background: "var(--chart-surface)", borderColor: "var(--border-hairline)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between border-b px-5 py-4"
              style={{ borderColor: "var(--gridline)" }}
            >
              <h3 className="text-lg font-medium" style={{ color: "var(--text-primary)" }}>
                {METRIC_TITLES[metric]}
                {rows ? ` (${rows.length})` : ""}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-2 py-1 text-sm hover:bg-white/10"
                style={{ color: "var(--text-secondary)" }}
              >
                Close
              </button>
            </div>

            {metric === "replies" && (
              <p
                className="border-b px-5 py-2 text-xs"
                style={{ borderColor: "var(--gridline)", color: "var(--text-muted)" }}
              >
                Replies are inferred from the contact auto-unenrolling from its sequence — HubSpot
                doesn&apos;t expose whether it was an email or call reply, so that distinction
                isn&apos;t shown.
              </p>
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
                          {r.dispositionLabel ?? "No disposition logged"}
                          {r.lastCallAt ? ` · ${new Date(r.lastCallAt).toLocaleString()}` : ""}
                        </div>
                      )}
                      {metric === "meetings" && r.lastMeetingAt && (
                        <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                          {new Date(r.lastMeetingAt).toLocaleString()}
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
      )}
    </>
  );
}
