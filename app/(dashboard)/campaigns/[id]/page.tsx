import { notFound } from "next/navigation";
import { StatTile, StatTileRow } from "@/components/StatTile";
import { DrillDownStatTile } from "@/components/DrillDownStatTile";
import { EngagementBreakdown } from "@/components/EngagementBreakdown";
import { RepBreakdownTable } from "@/components/RepBreakdownTable";
import { CompanyRollupTable } from "@/components/CompanyRollupTable";
import {
  getCampaign,
  getCompanyRollup,
  getEngagementBreakdown,
  getFunnelCounts,
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

  const [funnel, engagement, reps, companies] = await Promise.all([
    getFunnelCounts(campaignId),
    getEngagementBreakdown(campaignId),
    getRepBreakdown(campaignId),
    getCompanyRollup(campaignId),
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
        <StatTile label="Companies Targeted" value={funnel.companiesTargeted} />
        <StatTile label="Companies Engaged" value={funnel.companiesEngaged} />
        <StatTile label="Companies Unengaged" value={funnel.companiesUnengaged} />
      </StatTileRow>

      <EngagementBreakdown counts={engagement} />

      <div>
        <h2 className="mb-3 text-lg font-medium">Companies</h2>
        <CompanyRollupTable rows={companies} />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-medium">By Rep</h2>
        <RepBreakdownTable rows={reps} />
      </div>
    </div>
  );
}
