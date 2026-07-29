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

const LANE_HEIGHT = 56;
const BAR_WIDTH = 18;
const BAR_GAP = 6;
const SEGMENT_GAP = 2;
const COLUMN_PX = BAR_WIDTH + BAR_GAP;
const LABEL_COL_WIDTH = 78;

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

type Bar = { value: number; secondary?: number };

// One lane = one independently-scaled mini bar chart. Bars are positioned
// identically across all three lanes (same index -> same column), so
// hovering any bar in any lane can highlight that day everywhere.
function Lane({
  bars,
  color,
  secondaryColor,
  hoverIdx,
  onHover,
}: {
  bars: Bar[];
  color: string;
  secondaryColor?: string;
  hoverIdx: number | null;
  onHover: (i: number | null) => void;
}) {
  const maxValue = Math.max(1, ...bars.map((b) => b.value + (b.secondary ?? 0)));

  return (
    <div className="flex items-end" style={{ height: LANE_HEIGHT, gap: BAR_GAP }}>
      {bars.map((b, i) => {
        const primaryH = b.value > 0 ? Math.max(2, Math.round((b.value / maxValue) * LANE_HEIGHT)) : 0;
        const secondaryH =
          b.secondary && b.secondary > 0 ? Math.max(2, Math.round((b.secondary / maxValue) * LANE_HEIGHT)) : 0;
        const isHovered = hoverIdx === i;

        return (
          <div
            key={i}
            className="relative flex-shrink-0"
            style={{ width: BAR_WIDTH, height: LANE_HEIGHT }}
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
          >
            {isHovered && (
              <div className="absolute inset-0 rounded-t" style={{ background: "rgba(14, 165, 183, 0.12)" }} />
            )}
            {primaryH === 0 && secondaryH === 0 && (
              <div className="absolute bottom-0 w-full rounded-t" style={{ height: 2, background: "var(--gridline)" }} />
            )}
            {primaryH > 0 && (
              <div
                className={`absolute bottom-0 w-full transition-opacity ${secondaryH === 0 ? "rounded-t" : ""}`}
                style={{ height: primaryH, background: color, opacity: isHovered ? 0.85 : 1 }}
              />
            )}
            {secondaryH > 0 && (
              <div
                className="absolute w-full rounded-t transition-opacity"
                style={{
                  bottom: primaryH > 0 ? primaryH + SEGMENT_GAP : 0,
                  height: secondaryH,
                  background: secondaryColor,
                  opacity: isHovered ? 0.85 : 1,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function LaneLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="hud-heading flex flex-shrink-0 items-center text-[10px]"
      style={{ width: LABEL_COL_WIDTH, height: LANE_HEIGHT, color: "var(--text-muted)" }}
    >
      {children}
    </div>
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

  const { dates, callBars, connectBars, meetingBars } = useMemo(() => {
    const callByDate = new Map(callStats.map((d) => [d.date, d]));
    const meetingByDate = new Map(meetingStats.map((d) => [d.date, d.meetingsBooked]));
    const dates = Array.from(new Set([...callByDate.keys(), ...meetingByDate.keys()])).sort();

    return {
      dates,
      callBars: dates.map((date): Bar => ({ value: callByDate.get(date)?.callsMade ?? 0 })),
      connectBars: dates.map((date): Bar => {
        const d = callByDate.get(date);
        return { value: d?.connects ?? 0, secondary: d?.wrongTitle ?? 0 };
      }),
      meetingBars: dates.map((date): Bar => ({ value: meetingByDate.get(date) ?? 0 })),
    };
  }, [callStats, meetingStats]);

  if (dates.length === 0) {
    return (
      <p className="border-b px-5 py-4 text-xs" style={{ borderColor: "var(--gridline)", color: "var(--text-muted)" }}>
        No activity logged in this window yet.
      </p>
    );
  }

  const labelStride = Math.max(1, Math.ceil(60 / COLUMN_PX), Math.ceil(dates.length / 20));

  const totalCalls = callBars.reduce((sum, b) => sum + b.value, 0);
  const totalConnects = connectBars.reduce((sum, b) => sum + b.value, 0);
  const totalWrong = connectBars.reduce((sum, b) => sum + (b.secondary ?? 0), 0);
  const totalMeetings = meetingBars.reduce((sum, b) => sum + b.value, 0);
  const hoveredDate = hoverIdx != null ? dates[hoverIdx] : null;

  return (
    <div className="border-b px-5 py-4" style={{ borderColor: "var(--gridline)" }}>
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

      {/* Shared readout, outside the scrolling bar area below so it's never
          clipped by it — shows totals by default, the hovered day's numbers
          across all three lanes together on hover (the actual "compare by
          day" payoff). */}
      <div className="mb-3 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-sm" style={{ color: "var(--text-secondary)" }}>
        {hoveredDate ? (
          <>
            <span className="hud-heading text-xs" style={{ color: "var(--text-muted)" }}>
              {formatFullDate(hoveredDate)}
            </span>
            <span>
              <span className="font-semibold tabular-nums" style={{ color: "var(--series-blue)" }}>
                {callBars[hoverIdx!].value}
              </span>{" "}
              calls
            </span>
            <span>
              <span className="font-semibold tabular-nums" style={{ color: "var(--series-blue)" }}>
                {connectBars[hoverIdx!].value}
              </span>{" "}
              connected
            </span>
            <span>
              <span className="font-semibold tabular-nums" style={{ color: "var(--series-red)" }}>
                {connectBars[hoverIdx!].secondary}
              </span>{" "}
              wrong title
            </span>
            <span>
              <span className="font-semibold tabular-nums" style={{ color: "var(--series-aqua)" }}>
                {meetingBars[hoverIdx!].value}
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
            meetings across {dates.length} days — hover a bar for a specific day
          </span>
        )}
      </div>

      <div className="flex">
        <div className="flex flex-shrink-0 flex-col">
          <LaneLabel>Calls</LaneLabel>
          <LaneLabel>Connects</LaneLabel>
          <LaneLabel>Meetings</LaneLabel>
          <div style={{ width: LABEL_COL_WIDTH, height: 18 }} />
        </div>
        <div className="overflow-x-auto pb-1">
          <div className="flex flex-col">
            <Lane bars={callBars} color="var(--series-blue)" hoverIdx={hoverIdx} onHover={setHoverIdx} />
            <Lane
              bars={connectBars}
              color="var(--series-blue)"
              secondaryColor="var(--series-red)"
              hoverIdx={hoverIdx}
              onHover={setHoverIdx}
            />
            <Lane bars={meetingBars} color="var(--series-aqua)" hoverIdx={hoverIdx} onHover={setHoverIdx} />
            <div className="mt-1.5 flex" style={{ width: "max-content", gap: BAR_GAP }}>
              {dates.map((date, i) => (
                <div
                  key={date}
                  className="flex-shrink-0 text-center text-[10px] whitespace-nowrap tabular-nums"
                  style={{ width: BAR_WIDTH, color: hoverIdx === i ? "var(--series-blue)" : "var(--text-muted)" }}
                >
                  {i % labelStride === 0 ? formatAxisLabel(date) : ""}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
