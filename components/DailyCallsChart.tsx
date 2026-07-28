"use client";

import { useState } from "react";

export type DailyCallStat = {
  date: string;
  callsMade: number;
  connects: number;
  // Wrong Title only — Wrong Number isn't counted in Connects at all (a
  // wrong number never actually reached anyone), see classifyForDailyChart
  // in lib/sync.ts.
  wrongTitle: number;
};

const CHART_HEIGHT = 140;
const BAR_WIDTH = 18;
const BAR_GAP = 6;
const SEGMENT_GAP = 2;
const COLUMN_PX = BAR_WIDTH + BAR_GAP;

function toUTCDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// "Jul 24" reads as a date at a glance — the previous "7/24" packed tightly
// next to "7/27" etc. read as one long run of digits and slashes with no
// clear break between days.
function formatAxisLabel(dateStr: string) {
  return toUTCDate(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatFullDate(dateStr: string) {
  return toUTCDate(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function DailyCallsChart({
  data,
  mode,
}: {
  data: DailyCallStat[];
  mode: "calls" | "connects";
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <p className="border-b px-5 py-4 text-xs" style={{ borderColor: "var(--gridline)", color: "var(--text-muted)" }}>
        No calls logged in this window yet.
      </p>
    );
  }

  const maxValue =
    mode === "calls"
      ? Math.max(1, ...data.map((d) => d.callsMade))
      : Math.max(1, ...data.map((d) => d.connects + d.wrongTitle));

  // Only show as many axis labels as fit with real visual separation between
  // them (~44px), and never more than ~20 regardless — otherwise short date
  // text on narrow columns starts to visually run together.
  const labelStride = Math.max(1, Math.ceil(60 / COLUMN_PX), Math.ceil(data.length / 20));

  const totalCalls = data.reduce((sum, d) => sum + d.callsMade, 0);
  const totalConnects = data.reduce((sum, d) => sum + d.connects, 0);
  const totalWrong = data.reduce((sum, d) => sum + d.wrongTitle, 0);
  const hovered = hoverIdx != null ? data[hoverIdx] : null;

  return (
    <div className="border-b px-5 py-4" style={{ borderColor: "var(--gridline)" }}>
      {mode === "connects" && (
        <div className="mb-3 flex items-center gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--series-blue)" }} />
            Connected
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--series-red)" }} />
            Wrong title
          </span>
        </div>
      )}

      {/* Fixed readout — lives outside the horizontally-scrolling bar area
          below, so it's never clipped the way an in-flow hover tooltip was.
          Shows a default total when nothing's hovered, the exact day's
          numbers on hover. */}
      <div className="mb-3 flex h-5 items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
        {hovered ? (
          mode === "calls" ? (
            <>
              <span className="hud-heading text-xs" style={{ color: "var(--text-muted)" }}>
                {formatFullDate(hovered.date)}
              </span>
              <span>
                <span className="font-semibold tabular-nums" style={{ color: "var(--series-blue)" }}>
                  {hovered.callsMade}
                </span>{" "}
                call{hovered.callsMade === 1 ? "" : "s"}
              </span>
            </>
          ) : (
            <>
              <span className="hud-heading text-xs" style={{ color: "var(--text-muted)" }}>
                {formatFullDate(hovered.date)}
              </span>
              <span>
                <span className="font-semibold tabular-nums" style={{ color: "var(--series-blue)" }}>
                  {hovered.connects}
                </span>{" "}
                connected
              </span>
              <span>
                <span className="font-semibold tabular-nums" style={{ color: "var(--series-red)" }}>
                  {hovered.wrongTitle}
                </span>{" "}
                wrong title
              </span>
            </>
          )
        ) : mode === "calls" ? (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Total{" "}
            <span className="font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>
              {totalCalls}
            </span>{" "}
            calls across {data.length} days — hover a bar for a specific day
          </span>
        ) : (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Total{" "}
            <span className="font-medium tabular-nums" style={{ color: "var(--series-blue)" }}>
              {totalConnects}
            </span>{" "}
            connected,{" "}
            <span className="font-medium tabular-nums" style={{ color: "var(--series-red)" }}>
              {totalWrong}
            </span>{" "}
            wrong title — hover a bar for a specific day
          </span>
        )}
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="flex items-end" style={{ height: CHART_HEIGHT, gap: BAR_GAP }}>
          {data.map((d, i) => {
            const connectedValue = mode === "calls" ? d.callsMade : d.connects;
            const wrongValue = mode === "connects" ? d.wrongTitle : 0;
            const connectedH = connectedValue > 0 ? Math.max(2, Math.round((connectedValue / maxValue) * CHART_HEIGHT)) : 0;
            const wrongH = wrongValue > 0 ? Math.max(2, Math.round((wrongValue / maxValue) * CHART_HEIGHT)) : 0;
            const isHovered = hoverIdx === i;

            return (
              <div
                key={d.date}
                className="relative flex-shrink-0"
                style={{ width: BAR_WIDTH, height: CHART_HEIGHT }}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx((cur) => (cur === i ? null : cur))}
              >
                {/* Full-height column highlight — the hover affordance now
                    that the value itself lives in the readout above, not a
                    popup anchored to the bar. */}
                {isHovered && (
                  <div
                    className="absolute inset-0 rounded-t"
                    style={{ background: "rgba(14, 165, 183, 0.12)" }}
                  />
                )}

                {connectedH === 0 && wrongH === 0 && (
                  <div className="absolute bottom-0 w-full rounded-t" style={{ height: 2, background: "var(--gridline)" }} />
                )}

                {connectedH > 0 && (
                  <div
                    className={`absolute bottom-0 w-full transition-opacity ${wrongH === 0 ? "rounded-t" : ""}`}
                    style={{ height: connectedH, background: "var(--series-blue)", opacity: isHovered ? 0.85 : 1 }}
                  />
                )}
                {wrongH > 0 && (
                  <div
                    className="absolute w-full rounded-t transition-opacity"
                    style={{
                      bottom: connectedH > 0 ? connectedH + SEGMENT_GAP : 0,
                      height: wrongH,
                      background: "var(--series-red)",
                      opacity: isHovered ? 0.85 : 1,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex" style={{ width: "max-content", gap: BAR_GAP }}>
          {data.map((d, i) => (
            <div
              key={d.date}
              className="flex-shrink-0 text-center text-[10px] whitespace-nowrap tabular-nums"
              style={{ width: BAR_WIDTH, color: hoverIdx === i ? "var(--series-blue)" : "var(--text-muted)" }}
            >
              {i % labelStride === 0 ? formatAxisLabel(d.date) : ""}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
