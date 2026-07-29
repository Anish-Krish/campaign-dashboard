"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { RangeKey, ResolvedDateRange } from "@/lib/date-range";

const PRESETS: { key: RangeKey; label: string }[] = [
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "last_30", label: "Last 30 days" },
  { key: "last_90", label: "Last 90 days" },
  { key: "custom", label: "Custom" },
];

export function DateRangeFilter({ current }: { current: ResolvedDateRange }) {
  const router = useRouter();
  const pathname = usePathname();
  const [from, setFrom] = useState(current.startDate);
  const [to, setTo] = useState(current.endDate);

  function go(range: RangeKey, custom?: { from: string; to: string }) {
    const params = new URLSearchParams();
    params.set("range", range);
    if (range === "custom" && custom) {
      params.set("from", custom.from);
      params.set("to", custom.to);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      {PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => (p.key === "custom" ? go("custom", { from, to }) : go(p.key))}
          className="hud-button rounded-full px-3 py-1.5 text-xs"
          style={
            current.range === p.key
              ? { background: "var(--series-blue)", color: "#04211f", borderColor: "var(--series-blue)" }
              : undefined
          }
        >
          {p.label}
        </button>
      ))}

      {current.range === "custom" && (
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => {
              setFrom(e.target.value);
              go("custom", { from: e.target.value, to });
            }}
            className="rounded border bg-transparent px-2 py-1"
            style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
          />
          <span>to</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => {
              setTo(e.target.value);
              go("custom", { from, to: e.target.value });
            }}
            className="rounded border bg-transparent px-2 py-1"
            style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
          />
        </div>
      )}
    </div>
  );
}
