import { notFound } from "next/navigation";
import { StatTile, StatTileRow } from "@/components/StatTile";
import { DrillDownStatTile } from "@/components/DrillDownStatTile";
import { EngagementBreakdown } from "@/components/EngagementBreakdown";
import { RepBreakdownTable } from "@/components/RepBreakdownTable";
import { CompaniesExplorer } from "@/components/CompaniesExplorer";
import { CompanyCallFrequency } from "@/components/CompanyCallFrequency";
import { MeetingsTable } from "@/components/MeetingsTable";
import { ViewTabs } from "@/components/ViewTabs";
import {
  getCampaign,
  getCompaniesExplorerData,
  getCompanyEngagementSummary,
  getEngagementBreakdown,
  getFunnelCounts,
  getMeetingsList,
  getMeetingsPipelineStats,
  getRepBreakdown,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isFinite(campaignId)) notFound();

  const campaign = await getCampaign(campaignId);
  if (!campaign) notFound();

  const [funnel, engagement, reps, companyExplorerRows, meetingStats, meetingsList, companySummary] =
    await Promise.all([
      getFunnelCounts(campaignId),
      getEngagementBreakdown(campaignId),
      getRepBreakdown(campaignId),
      getCompaniesExplorerData(campaignId),
      getMeetingsPipelineStats(campaignId),
      getMeetingsList(campaignId),
      getCompanyEngagementSummary(campaignId),
    ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{campaign.name}</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Owner: {campaign.ownerName ?? "—"}
          {campaign.sequenceLabel ? ` · Sequence: ${campaign.sequenceLabel}` : ""}
        </p>
      </div>

      <StatTileRow>
        <DrillDownStatTile
          label="Contacts Enrolled"
          value={funnel.enrolled}
          metric="enrolled"
          campaignId={campaignId}
        />
        <DrillDownStatTile
          label="Calls Made"
          value={funnel.callsMade}
          metric="calls"
          campaignId={campaignId}
        />
        <DrillDownStatTile
          label="Connects"
          value={funnel.connects}
          metric="connects"
          campaignId={campaignId}
        />
        <DrillDownStatTile
          label="Replies"
          value={funnel.replies}
          metric="replies"
          campaignId={campaignId}
        />
        <DrillDownStatTile
          label="Meetings Booked"
          value={funnel.meetings}
          metric="meetings"
          campaignId={campaignId}
        />
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
                <EngagementBreakdown counts={engagement} />
                <div>
                  <h2 className="mb-3 text-lg font-medium">Companies</h2>
                  <CompaniesExplorer rows={companyExplorerRows} />
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
                <div>
                  <h2 className="mb-3 text-lg font-medium">Meetings</h2>
                  <MeetingsTable rows={meetingsList} />
                </div>
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
