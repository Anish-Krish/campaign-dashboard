import { ENGAGEMENT_LABELS, ENGAGEMENT_STATUSES, type EngagementStatus } from "@/lib/queries";

const COLORS: Record<EngagementStatus, string> = {
  unengaged: "var(--text-muted)",
  not_interested: "var(--series-red)",
  unqualified: "var(--series-orange)",
  activated_lead: "var(--series-aqua)",
  meeting_booked: "var(--series-blue)",
};

export function EngagementBreakdown({ counts }: { counts: Record<EngagementStatus, number> }) {
  const total = ENGAGEMENT_STATUSES.reduce((sum, s) => sum + counts[s], 0) || 1;

  return (
    <div
      className="rounded-lg border p-4"
      style={{ background: "var(--chart-surface)", borderColor: "var(--border-hairline)" }}
    >
      <h3 className="mb-4 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Companies engaged vs. unengaged
      </h3>
      <div className="space-y-3">
        {ENGAGEMENT_STATUSES.map((status) => {
          const count = counts[status];
          const pct = Math.round((count / total) * 100);
          return (
            <div key={status}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: COLORS[status] }}
                    aria-hidden
                  />
                  {ENGAGEMENT_LABELS[status]}
                </span>
                <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
                  {count}
                </span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full"
                style={{ background: "var(--gridline)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: COLORS[status] }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
