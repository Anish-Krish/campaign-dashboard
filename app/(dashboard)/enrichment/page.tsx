import { EnrichmentExplorer } from "@/components/EnrichmentExplorer";
import { triggerEnrichmentRun } from "./actions";
import { getCampaignsForEnrichment, getEnrichmentRun, getEnrichmentRows, getEnrichmentRuns } from "@/lib/queries";

export const dynamic = "force-dynamic";

const inputStyle = { borderColor: "var(--border-hairline)", color: "var(--text-primary)" };

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

      <div className="hud-panel space-y-3 p-4">
        <form action={triggerEnrichmentRun} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs" style={{ color: "var(--text-secondary)" }}>
              Campaign
            </label>
            <select
              name="campaignId"
              required
              defaultValue=""
              className="rounded border bg-transparent px-2 py-1.5 text-sm"
              style={inputStyle}
            >
              <option value="" disabled>
                Select a campaign…
              </option>
              {campaignOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.authorityContacts} authority / {c.totalContacts} total
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 pb-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" name="authorityOnly" defaultChecked />
            Authority contacts only
          </label>
          <button type="submit" className="hud-button rounded px-3 py-1.5 text-xs">
            Start Enrichment
          </button>
        </form>
      </div>

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
