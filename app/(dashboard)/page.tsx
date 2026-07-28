import Link from "next/link";
import { StatTile, StatTileRow } from "@/components/StatTile";
import { DrillDownStatTile } from "@/components/DrillDownStatTile";
import { EngagementBreakdown } from "@/components/EngagementBreakdown";
import { RepBreakdownTable } from "@/components/RepBreakdownTable";
import { MeetingsTable } from "@/components/MeetingsTable";
import { CompanyCallFrequency } from "@/components/CompanyCallFrequency";
import { CompaniesExplorer } from "@/components/CompaniesExplorer";
import { ViewTabs } from "@/components/ViewTabs";
import { SyncNowButton } from "@/components/SyncNowButton";
import {
  getCampaignsWithCounts,
  getCompaniesExplorerData,
  getCompanyEngagementSummary,
  getEngagementBreakdown,
  getFunnelCounts,
  getLastSyncRun,
  getMeetingsList,
  getMeetingsPipelineStats,
  getRepBreakdown,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [
    funnel,
    engagement,
    reps,
    lastSync,
    campaignList,
    meetingStats,
    meetingsList,
    companySummary,
    companyExplorerRows,
  ] = await Promise.all([
    getFunnelCounts(),
    getEngagementBreakdown(),
    getRepBreakdown(),
    getLastSyncRun(),
    getCampaignsWithCounts(),
    getMeetingsPipelineStats(),
    getMeetingsList(),
    getCompanyEngagementSummary(),
    getCompaniesExplorerData(),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <div className="flex items-center gap-3">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {lastSync
              ? `Last synced ${new Date(lastSync.startedAt).toLocaleString()} — ${lastSync.status}`
              : "No sync has run yet"}
          </p>
          <SyncNowButton />
        </div>
      </div>

      {lastSync?.status === "error" && lastSync.errorMessage && (
        <div
          className="rounded-lg border p-4 text-sm"
          style={{ borderColor: "var(--series-red)", color: "var(--series-red)" }}
        >
          Last sync had errors: {lastSync.errorMessage}
        </div>
      )}

      <StatTileRow>
        <DrillDownStatTile label="Contacts Enrolled" value={funnel.enrolled} metric="enrolled" />
        <DrillDownStatTile label="Calls Made" value={funnel.callsMade} metric="calls" />
        <DrillDownStatTile label="Connects" value={funnel.connects} metric="connects" />
        <DrillDownStatTile label="Replies" value={funnel.replies} metric="replies" />
        <DrillDownStatTile label="Meetings Booked" value={funnel.meetings} metric="meetings" />
      </StatTileRow>

      <ViewTabs
        tabs={[
          {
            label: "Companies",
            content: (
              <div className="space-y-8">
                <StatTileRow>
                  <StatTile label="Companies Targeted" value={funnel.companiesTargeted} />
                  <StatTile label="Companies Engaged" value={funnel.companiesEngaged} />
                  <StatTile label="Companies Unengaged" value={funnel.companiesUnengaged} />
                </StatTileRow>
                <CompanyCallFrequency summary={companySummary} />
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
                  <h2 className="mb-3 text-lg font-medium">Companies</h2>
                  <CompaniesExplorer rows={companyExplorerRows} showCampaignColumn />
                </div>
              </div>
            ),
          },
          {
            label: "Meetings",
            content: (
              <div className="space-y-8">
                <StatTileRow>
                  <StatTile label="Meeting Sat" value={meetingStats.meetingSat} />
                  <StatTile label="Still to Sit" value={meetingStats.stillToSit} />
                  <StatTile label="Needs Rebooked" value={meetingStats.needsRebooked} />
                  <StatTile label="SQO" value={meetingStats.sqo} />
                  <StatTile label="SQL" value={meetingStats.sql} />
                  <StatTile
                    label="Meeting Sat vs SQO"
                    value={`${meetingStats.meetingSatVsSqoPercent}%`}
                    percent={meetingStats.meetingSatVsSqoPercent}
                  />
                </StatTileRow>
                <MeetingsTable rows={meetingsList} />
              </div>
            ),
          },
        ]}
      />

      <div>
        <h2 className="mb-3 text-lg font-medium">By Rep</h2>
        <RepBreakdownTable rows={reps} />
      </div>
    </div>
  );
}
