import Link from "next/link";
import { StatTile, StatTileRow } from "@/components/StatTile";
import { EngagementBreakdown } from "@/components/EngagementBreakdown";
import { RepBreakdownTable } from "@/components/RepBreakdownTable";
import {
  getCampaignsWithCounts,
  getEngagementBreakdown,
  getFunnelCounts,
  getLastSyncRun,
  getRepBreakdown,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [funnel, engagement, reps, lastSync, campaignList] = await Promise.all([
    getFunnelCounts(),
    getEngagementBreakdown(),
    getRepBreakdown(),
    getLastSyncRun(),
    getCampaignsWithCounts(),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {lastSync
            ? `Last synced ${new Date(lastSync.startedAt).toLocaleString()} — ${lastSync.status}`
            : "No sync has run yet"}
        </p>
      </div>

      <StatTileRow>
        <StatTile label="Contacts Enrolled" value={funnel.enrolled} />
        <StatTile label="Calls Made" value={funnel.callsMade} />
        <StatTile label="Connects" value={funnel.connects} />
        <StatTile label="Replies" value={funnel.replies} />
        <StatTile label="Meetings Booked" value={funnel.meetings} />
        <StatTile label="Companies Targeted" value={funnel.companiesTargeted} />
        <StatTile label="Companies Engaged" value={funnel.companiesEngaged} />
        <StatTile label="Companies Unengaged" value={funnel.companiesUnengaged} />
      </StatTileRow>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <EngagementBreakdown counts={engagement} />
        <div
          className="rounded-lg border p-4"
          style={{ background: "var(--chart-surface)", borderColor: "var(--border-hairline)" }}
        >
          <h3 className="mb-4 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            Campaigns
          </h3>
          <ul className="space-y-3 text-sm">
            {campaignList.length === 0 && (
              <li style={{ color: "var(--text-muted)" }}>
                No campaigns yet — add one in Settings.
              </li>
            )}
            {campaignList.map((c) => (
              <li key={c.id} className="flex items-center justify-between">
                <Link
                  href={`/campaigns/${c.id}`}
                  className="hover:underline"
                  style={{ color: "var(--series-blue)" }}
                >
                  {c.name}
                </Link>
                <span style={{ color: "var(--text-secondary)" }}>
                  {c.delivered}
                  {c.targetCount != null ? ` / ${c.targetCount}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-medium">By Rep</h2>
        <RepBreakdownTable rows={reps} />
      </div>
    </div>
  );
}
