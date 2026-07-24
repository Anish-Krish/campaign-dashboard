import { ENGAGEMENT_LABELS, type EngagementStatus } from "@/lib/queries";

const COLORS: Record<EngagementStatus, string> = {
  unengaged: "var(--text-muted)",
  not_interested: "var(--series-red)",
  unqualified: "var(--series-orange)",
  activated_lead: "var(--series-aqua)",
  meeting_booked: "var(--series-blue)",
};

type CompanyRow = {
  companyId: string;
  companyName: string;
  industry: string | null;
  engagementStatus: EngagementStatus;
  statusUpdatedAt: Date | null;
  contactCount: number;
};

export function CompanyRollupTable({ rows }: { rows: CompanyRow[] }) {
  return (
    <div
      className="overflow-x-auto rounded-lg border"
      style={{ background: "var(--chart-surface)", borderColor: "var(--border-hairline)" }}
    >
      <table className="w-full text-left text-sm">
        <thead>
          <tr style={{ color: "var(--text-secondary)" }} className="border-b">
            <th className="px-4 py-3 font-medium" style={{ borderColor: "var(--border-hairline)" }}>
              Company
            </th>
            <th className="px-4 py-3 font-medium">Industry</th>
            <th className="px-4 py-3 font-medium"># Contacts</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Since</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center" style={{ color: "var(--text-muted)" }}>
                No companies synced yet
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.companyId} className="border-t" style={{ borderColor: "var(--gridline)" }}>
              <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>
                {r.companyName}
              </td>
              <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                {r.industry ?? "—"}
              </td>
              <td className="px-4 py-3 tabular-nums">{r.contactCount}</td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: COLORS[r.engagementStatus] }}
                    aria-hidden
                  />
                  {ENGAGEMENT_LABELS[r.engagementStatus]}
                </span>
              </td>
              <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                {r.statusUpdatedAt ? new Date(r.statusUpdatedAt).toLocaleDateString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
