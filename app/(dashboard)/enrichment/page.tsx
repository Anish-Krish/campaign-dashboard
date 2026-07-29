import { EnrichmentExplorer } from "@/components/EnrichmentExplorer";
import { StartEnrichmentPanel } from "@/components/StartEnrichmentPanel";
import { getCampaignsForEnrichment, getEnrichmentRun, getEnrichmentRows, getEnrichmentRuns } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function EnrichmentPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const { run } = await searchParams;

  const [campaignOptions, recentRuns] = await Promise.all([getCampaignsForEnrichment(), getEnrichmentRuns()]);

  const selectedRunId = run ? Number(run) : recentRuns[0]?.id;
  const [selectedRun, selectedRows] = selectedRunId
    ? await Promise.all([getEnrichmentRun(selectedRunId), getEnrichmentRows(selectedRunId)])
    : [null, []];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Enrichment</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Find missing emails and mobile numbers for a campaign&apos;s contacts via LeadMagic, Prospeo, and
          ZeroBounce.
        </p>
      </div>

      <StartEnrichmentPanel campaignOptions={campaignOptions} />

      {recentRuns.length > 0 && (
        <div className="hud-panel p-4">
          <h2 className="hud-heading mb-2 text-xs">Recent runs</h2>
          <ul className="space-y-1 text-sm">
            {recentRuns.map((r) => (
              <li key={r.id}>
                <a
                  href={`/enrichment?run=${r.id}`}
                  className="hover:underline"
                  style={{ color: r.id === selectedRunId ? "var(--series-blue)" : "var(--text-secondary)" }}
                >
                  {r.label ?? `Run #${r.id}`} — {r.status} ({r.processedRows}/{r.totalRows})
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selectedRun && <EnrichmentExplorer runId={selectedRun.id} initialRun={selectedRun} initialRows={selectedRows} />}
    </div>
  );
}
