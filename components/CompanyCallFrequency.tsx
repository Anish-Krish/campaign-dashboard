import { StatTile, StatTileRow } from "@/components/StatTile";

const BUCKET_LABELS: Record<string, string> = {
  "0": "0 calls",
  "1": "1 call",
  "2": "2 calls",
  "3+": "3+ calls",
};
const BUCKET_ORDER = ["0", "1", "2", "3+"];

export function CompanyCallFrequency({
  summary,
}: {
  summary: {
    companiesEnrolled: number;
    companiesContacted: number;
    contactRatePercent: number;
    callBuckets: Record<string, number>;
  };
}) {
  const total = summary.companiesEnrolled || 1;

  return (
    <div className="space-y-4">
      <StatTileRow>
        <StatTile label="Companies Enrolled" value={summary.companiesEnrolled} />
        <StatTile label="Authority Contact Reached ≥1x" value={summary.companiesContacted} />
        <StatTile
          label="Contact Rate"
          value={`${summary.contactRatePercent}%`}
          percent={summary.contactRatePercent}
        />
      </StatTileRow>

      <div className="hud-panel p-4">
        <h3 className="hud-heading mb-4 text-xs">
          Calls to authority contact (of {summary.companiesEnrolled} enrolled {summary.companiesEnrolled === 1 ? "company" : "companies"})
        </h3>
        <div className="space-y-3">
          {BUCKET_ORDER.map((bucket) => {
            const count = summary.callBuckets[bucket] ?? 0;
            const pct = Math.round((count / total) * 100);
            return (
              <div key={bucket}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span style={{ color: "var(--text-primary)" }}>{BUCKET_LABELS[bucket]}</span>
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
                    style={{ width: `${pct}%`, background: "var(--series-blue)" }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
