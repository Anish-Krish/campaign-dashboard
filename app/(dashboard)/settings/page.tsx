import { getAuthorityKeywords } from "@/lib/authority";
import { getCampaignsWithCounts } from "@/lib/queries";
import { createCampaign, deleteCampaign, saveAuthorityKeywords, updateCampaignStatus } from "./actions";

export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded border bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500";
const inputStyle = { borderColor: "var(--border-hairline)", color: "var(--text-primary)" };
const cardStyle = { background: "var(--chart-surface)", borderColor: "var(--border-hairline)" };
const labelStyle = { color: "var(--text-secondary)" };

export default async function SettingsPage() {
  const [campaigns, keywords] = await Promise.all([
    getCampaignsWithCounts(),
    getAuthorityKeywords(),
  ]);

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="rounded-lg border p-5" style={cardStyle}>
        <h2 className="mb-4 text-lg font-medium">Add campaign</h2>
        <form action={createCampaign} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm" style={labelStyle}>
              Campaign name
            </label>
            <input name="name" required className={inputClass} style={inputStyle} />
          </div>
          <div>
            <label className="mb-1 block text-sm" style={labelStyle}>
              HubSpot List ID
            </label>
            <input name="hubspotListId" required className={inputClass} style={inputStyle} />
          </div>
          <div>
            <label className="mb-1 block text-sm" style={labelStyle}>
              Sequence label (optional)
            </label>
            <input name="sequenceLabel" className={inputClass} style={inputStyle} />
          </div>
          <div>
            <label className="mb-1 block text-sm" style={labelStyle}>
              Target count
            </label>
            <input name="targetCount" type="number" className={inputClass} style={inputStyle} />
          </div>
          <div>
            <label className="mb-1 block text-sm" style={labelStyle}>
              Owner name
            </label>
            <input name="ownerName" className={inputClass} style={inputStyle} />
          </div>
          <div>
            <label className="mb-1 block text-sm" style={labelStyle}>
              Owner email
            </label>
            <input name="ownerEmail" type="email" className={inputClass} style={inputStyle} />
          </div>
          <div>
            <label className="mb-1 block text-sm" style={labelStyle}>
              Start date
            </label>
            <input name="startDate" type="date" className={inputClass} style={inputStyle} />
          </div>
          <div>
            <label className="mb-1 block text-sm" style={labelStyle}>
              End date
            </label>
            <input name="endDate" type="date" className={inputClass} style={inputStyle} />
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              Add campaign
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border p-5" style={cardStyle}>
        <h2 className="mb-4 text-lg font-medium">Campaigns</h2>
        <div className="space-y-3">
          {campaigns.length === 0 && (
            <p style={{ color: "var(--text-muted)" }}>No campaigns yet.</p>
          )}
          {campaigns.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"
              style={{ borderColor: "var(--gridline)" }}
            >
              <div>
                <div style={{ color: "var(--text-primary)" }} className="font-medium">
                  {c.name}
                </div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  List {c.hubspotListId} · {c.delivered}
                  {c.targetCount != null ? ` / ${c.targetCount}` : ""} delivered
                </div>
              </div>
              <div className="flex items-center gap-2">
                <form action={updateCampaignStatus} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={c.id} />
                  <select
                    name="status"
                    defaultValue={c.status}
                    className="rounded border bg-transparent px-2 py-1 text-sm"
                    style={inputStyle}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                  <button
                    type="submit"
                    className="rounded border px-2 py-1 text-sm hover:bg-white/5"
                    style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}
                  >
                    Save
                  </button>
                </form>
                <form action={deleteCampaign}>
                  <input type="hidden" name="id" value={c.id} />
                  <button
                    type="submit"
                    className="rounded border px-2 py-1 text-sm hover:bg-red-950"
                    style={{ borderColor: "var(--series-red)", color: "var(--series-red)" }}
                  >
                    Delete
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border p-5" style={cardStyle}>
        <h2 className="mb-2 text-lg font-medium">Authority keywords</h2>
        <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
          Comma-separated job-title keywords used to decide which contacts count as
          &ldquo;authority&rdquo; when a company&apos;s engagement status is derived.
        </p>
        <form action={saveAuthorityKeywords} className="flex flex-col gap-3 sm:flex-row">
          <textarea
            name="keywords"
            defaultValue={keywords.join(", ")}
            rows={2}
            className={`${inputClass} flex-1`}
            style={inputStyle}
          />
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 sm:self-start"
          >
            Save
          </button>
        </form>
      </section>
    </div>
  );
}
