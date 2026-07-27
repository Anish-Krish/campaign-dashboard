"use client";

import { useState } from "react";

export type DailyCallStat = {
  date: string;
  callsMade: number;
  connects: number;
  wrongTitleOrNumber: number;
};

const CHART_HEIGHT = 140;
const BAR_WIDTH = 18;
const BAR_GAP = 6;
const SEGMENT_GAP = 2;

function formatDateLabel(dateStr: string) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}/${d}`;
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
      : Math.max(1, ...data.map((d) => d.connects + d.wrongTitleOrNumber));

  // Thin dense date axes: show every label up to ~31 days, otherwise thin to
  // roughly 20 evenly-spaced ticks so labels never overlap.
  const labelStride = data.length <= 31 ? 1 : Math.ceil(data.length / 20);

  return (
    <div className="border-b px-5 py-4" style={{ borderColor: "var(--gridline)" }}>
      {mode === "connects" && (
        <div className="mb-3 flex items-center gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: "var(--series-blue)" }}
            />
            Connected
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: "var(--series-red)" }}
            />
            Wrong title / number
          </span>
        </div>
      )}

      <div className="overflow-x-auto pb-1">
        <div className="flex items-end gap-1.5" style={{ height: CHART_HEIGHT, gap: BAR_GAP }}>
          {data.map((d, i) => {
            const connectedValue = mode === "calls" ? d.callsMade : d.connects;
            const wrongValue = mode === "connects" ? d.wrongTitleOrNumber : 0;
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
                {isHovered && (
                  <div
                    className="absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded border px-2.5 py-1.5 text-xs shadow-lg"
                    style={{
                      background: "var(--chart-surface)",
                      borderColor: "var(--border-hairline)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <div className="mb-0.5" style={{ color: "var(--text-secondary)" }}>
                      {d.date}
                    </div>
                    {mode === "calls" ? (
                      <div>
                        <span className="font-medium">{d.callsMade}</span> call{d.callsMade === 1 ? "" : "s"}
                      </div>
                    ) : (
                      <>
                        <div>
                          <span className="font-medium">{d.connects}</span> connected
                        </div>
                        <div>
                          <span className="font-medium">{d.wrongTitleOrNumber}</span> wrong title/number
                        </div>
                      </>
                    )}
                  </div>
                )}

                {connectedH === 0 && wrongH === 0 && (
                  <div
                    className="absolute bottom-0 w-full rounded-t"
                    style={{ height: 2, background: "var(--gridline)" }}
                  />
                )}

                {connectedH > 0 && (
                  <div
                    className={`absolute bottom-0 w-full transition-opacity ${wrongH === 0 ? "rounded-t" : ""}`}
                    style={{
                      height: connectedH,
                      background: "var(--series-blue)",
                      opacity: isHovered ? 0.85 : 1,
                    }}
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
        <div className="mt-1 flex" style={{ width: "max-content", gap: BAR_GAP }}>
          {data.map((d, i) => (
            <div
              key={d.date}
              className="flex-shrink-0 text-center text-[10px] tabular-nums"
              style={{ width: BAR_WIDTH, color: "var(--text-muted)" }}
            >
              {i % labelStride === 0 ? formatDateLabel(d.date) : ""}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
