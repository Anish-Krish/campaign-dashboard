"use client";

import { useMemo, useState } from "react";

export type DailyCallStat = {
  date: string;
  callsMade: number;
  connects: number;
  // Wrong Title only — Wrong Number isn't counted in Connects at all (a
  // wrong number never actually reached anyone), see classifyForDailyChart
  // in lib/sync.ts.
  wrongTitle: number;
};

export type DailyMeetingStat = {
  date: string;
  meetingsBooked: number;
};

type Column = {
  date: string;
  callsMade: number;
  connects: number;
  wrongTitle: number;
  meetingsBooked: number;
};

const COLUMN_WIDTH = 24;
const FRONT_WIDTH = 12;
const COLUMN_GAP = 8;
const SEGMENT_GAP = 2;
const COLUMN_PX = COLUMN_WIDTH + COLUMN_GAP;
const MARKER_ROW_HEIGHT = 24;
const BAR_AREA_HEIGHT = 160;
const AXIS_LABEL_HEIGHT = 18;
const Y_AXIS_COL_WIDTH = 34;

function toUTCDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// "Jul 24" reads as a date at a glance — packing "7/24" tight against "7/27"
// etc. reads as one long run of digits and slashes with no clear break.
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

function LegendSwatch({ color, opacity = 1, label }: { color: string; opacity?: number; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color, opacity }} />
      {label}
    </span>
  );
}

export function ActivityByDayChart({
  callStats,
  meetingStats,
}: {
  callStats: DailyCallStat[];
  meetingStats: DailyMeetingStat[];
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const columns = useMemo<Column[]>(() => {
    const callByDate = new Map(callStats.map((d) => [d.date, d]));
    const meetingByDate = new Map(meetingStats.map((d) => [d.date, d.meetingsBooked]));
    const dates = Array.from(new Set([...callByDate.keys(), ...meetingByDate.keys()])).sort();

    return dates.map((date) => {
      const c = callByDate.get(date);
      return {
        date,
        callsMade: c?.callsMade ?? 0,
        connects: c?.connects ?? 0,
        wrongTitle: c?.wrongTitle ?? 0,
        meetingsBooked: meetingByDate.get(date) ?? 0,
      };
    });
  }, [callStats, meetingStats]);

  if (columns.length === 0) {
    return (
      <p className="border-b px-5 py-4 text-xs" style={{ borderColor: "var(--gridline)", color: "var(--text-muted)" }}>
        No activity logged in this window yet.
      </p>
    );
  }

  const hasCallData = columns.some((c) => c.callsMade > 0);
  const maxCalls = hasCallData ? Math.max(1, ...columns.map((c) => c.callsMade)) : 0;
  const labelStride = Math.max(1, Math.ceil(60 / COLUMN_PX), Math.ceil(columns.length / 20));

  const totalCalls = columns.reduce((sum, c) => sum + c.callsMade, 0);
  const totalConnects = columns.reduce((sum, c) => sum + c.connects, 0);
  const totalWrong = columns.reduce((sum, c) => sum + c.wrongTitle, 0);
  const totalMeetings = columns.reduce((sum, c) => sum + c.meetingsBooked, 0);
  const hovered = hoverIdx != null ? columns[hoverIdx] : null;

  return (
    <div className="border-b px-5 py-4" style={{ borderColor: "var(--gridline)" }}>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
        <LegendSwatch color="var(--series-blue)" opacity={0.28} label="Calls made" />
        <LegendSwatch color="var(--series-blue)" label="Connected" />
        <LegendSwatch color="var(--series-red)" label="Wrong title" />
        <LegendSwatch color="var(--series-aqua)" label="Meeting booked" />
      </div>

      {/* Shared readout, outside the scrolling bar area so it's never
          clipped by it — shows totals by default, the hovered day's numbers
          together on hover. */}
      <div className="mb-3 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-sm" style={{ color: "var(--text-secondary)" }}>
        {hovered ? (
          <>
            <span className="hud-heading text-xs" style={{ color: "var(--text-muted)" }}>
              {formatFullDate(hovered.date)}
            </span>
            <span>
              <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {hovered.callsMade}
              </span>{" "}
              calls
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
            <span>
              <span className="font-semibold tabular-nums" style={{ color: "var(--series-aqua)" }}>
                {hovered.meetingsBooked}
              </span>{" "}
              meetings
            </span>
          </>
        ) : (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Total{" "}
            <span className="font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>
              {totalCalls}
            </span>{" "}
            calls,{" "}
            <span className="font-medium tabular-nums" style={{ color: "var(--series-blue)" }}>
              {totalConnects}
            </span>{" "}
            connected,{" "}
            <span className="font-medium tabular-nums" style={{ color: "var(--series-red)" }}>
              {totalWrong}
            </span>{" "}
            wrong title,{" "}
            <span className="font-medium tabular-nums" style={{ color: "var(--series-aqua)" }}>
              {totalMeetings}
            </span>{" "}
            meetings across {columns.length} days — hover a bar for a specific day
          </span>
        )}
      </div>

      <div className="flex">
        {/* Y-axis: numeric ticks for the shared calls/connects scale. */}
        <div className="flex flex-shrink-0 flex-col" style={{ width: Y_AXIS_COL_WIDTH }}>
          <div style={{ height: MARKER_ROW_HEIGHT }} />
          <div className="relative" style={{ height: BAR_AREA_HEIGHT }}>
            {hasCallData && (
              <>
                <span
                  className="absolute right-1.5 text-[10px] tabular-nums"
                  style={{ top: 0, transform: "translateY(-50%)", color: "var(--text-muted)" }}
                >
                  {maxCalls}
                </span>
                <span
                  className="absolute right-1.5 text-[10px] tabular-nums"
                  style={{ top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}
                >
                  {Math.round(maxCalls / 2)}
                </span>
              </>
            )}
            <span
              className="absolute right-1.5 text-[10px] tabular-nums"
              style={{ bottom: 0, transform: "translateY(50%)", color: "var(--text-muted)" }}
            >
              0
            </span>
          </div>
          <div style={{ height: AXIS_LABEL_HEIGHT }} />
        </div>

        <div className="overflow-x-auto pb-1">
          <div className="relative" style={{ width: "max-content" }}>
            <div
              className="absolute"
              style={{ top: MARKER_ROW_HEIGHT, left: 0, right: 0, height: 1, background: "var(--gridline)" }}
            />
            <div
              className="absolute"
              style={{
                top: MARKER_ROW_HEIGHT + BAR_AREA_HEIGHT / 2,
                left: 0,
                right: 0,
                height: 1,
                background: "var(--gridline)",
              }}
            />
            <div
              className="absolute"
              style={{
                top: MARKER_ROW_HEIGHT + BAR_AREA_HEIGHT,
                left: 0,
                right: 0,
                height: 1,
                background: "var(--gridline)",
              }}
            />

            <div className="flex" style={{ gap: COLUMN_GAP }}>
              {columns.map((col, i) => {
                const backH =
                  col.callsMade > 0 ? Math.max(2, Math.round((col.callsMade / maxCalls) * BAR_AREA_HEIGHT)) : 0;
                const frontH =
                  col.connects > 0 ? Math.max(2, Math.round((col.connects / maxCalls) * BAR_AREA_HEIGHT)) : 0;
                const capH =
                  col.wrongTitle > 0 ? Math.max(2, Math.round((col.wrongTitle / maxCalls) * BAR_AREA_HEIGHT)) : 0;
                const capBottom = frontH + (frontH > 0 && capH > 0 ? SEGMENT_GAP : 0);
                const isHovered = hoverIdx === i;

                return (
                  <div
                    key={col.date}
                    className="flex flex-shrink-0 flex-col"
                    style={{ width: COLUMN_WIDTH }}
                    onMouseEnter={() => setHoverIdx(i)}
                    onMouseLeave={() => setHoverIdx(null)}
                  >
                    {/* Meeting marker row */}
                    <div className="flex items-center justify-center gap-0.5" style={{ height: MARKER_ROW_HEIGHT }}>
                      {col.meetingsBooked > 0 && (
                        <>
                          <span
                            className="inline-block rounded-full"
                            style={{ width: 6, height: 6, background: "var(--series-aqua)" }}
                          />
                          {col.meetingsBooked > 1 && (
                            <span
                              className="text-[10px] font-medium tabular-nums"
                              style={{ color: "var(--series-aqua)" }}
                            >
                              {col.meetingsBooked}
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    {/* Bar area: back bar = Calls Made, front bar = Connects,
                        capped with Wrong Title — all to the same scale, since
                        connects + wrongTitle <= callsMade always. */}
                    <div className="relative" style={{ height: BAR_AREA_HEIGHT }}>
                      {isHovered && (
                        <div className="absolute inset-0" style={{ background: "rgba(14, 165, 183, 0.1)" }} />
                      )}
                      <div
                        className="absolute bottom-0 rounded-t"
                        style={{
                          left: 0,
                          width: COLUMN_WIDTH,
                          height: backH,
                          background: "var(--series-blue)",
                          opacity: 0.28,
                        }}
                      />
                      {frontH > 0 && (
                        <div
                          className={`absolute bottom-0 transition-opacity ${capH === 0 ? "rounded-t" : ""}`}
                          style={{
                            left: (COLUMN_WIDTH - FRONT_WIDTH) / 2,
                            width: FRONT_WIDTH,
                            height: frontH,
                            background: "var(--series-blue)",
                            opacity: isHovered ? 0.85 : 1,
                          }}
                        />
                      )}
                      {capH > 0 && (
                        <div
                          className="absolute rounded-t transition-opacity"
                          style={{
                            left: (COLUMN_WIDTH - FRONT_WIDTH) / 2,
                            width: FRONT_WIDTH,
                            bottom: capBottom,
                            height: capH,
                            background: "var(--series-red)",
                            opacity: isHovered ? 0.85 : 1,
                          }}
                        />
                      )}
                    </div>

                    {/* Date axis label */}
                    <div
                      className="text-center text-[10px] whitespace-nowrap tabular-nums"
                      style={{
                        height: AXIS_LABEL_HEIGHT,
                        color: isHovered ? "var(--series-blue)" : "var(--text-muted)",
                      }}
                    >
                      {i % labelStride === 0 ? formatAxisLabel(col.date) : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
