import Link from "next/link";
import { CampaignsTable } from "@/components/CampaignsTable";
import { getCampaignsWithCounts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const campaigns = await getCampaignsWithCounts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <Link
          href="/settings"
          className="rounded border px-3 py-1.5 text-sm hover:bg-white/5"
          style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}
        >
          Manage campaigns
        </Link>
      </div>
      <CampaignsTable rows={campaigns} />
    </div>
  );
}
