import { getAuthorityKeywords } from "@/lib/authority";
import { getCampaignsWithCounts } from "@/lib/queries";
import { createCampaign, deleteCampaign, saveAuthorityKeywords, updateCampaign } from "./actions";

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
        <div className="space-y-4">
          {campaigns.length === 0 && (
            <p style={{ color: "var(--text-muted)" }}>No campaigns yet.</p>
          )}
          {campaigns.map((c) => (
            <details
              key={c.id}
              className="rounded border p-3"
              style={{ borderColor: "var(--gridline)" }}
            >
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                <div>
                  <span style={{ color: "var(--text-primary)" }} className="font-medium">
                    {c.name}
                  </span>
                  <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    List {c.hubspotListId} · {c.delivered}
                    {c.targetCount != null ? ` / ${c.targetCount}` : ""} delivered · {c.status}
                  </span>
                </div>
              </summary>

              <form
                action={updateCampaign}
                className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
              >
                <input type="hidden" name="id" value={c.id} />
                <div>
                  <label className="mb-1 block text-sm" style={labelStyle}>
                    Campaign name
                  </label>
                  <input
                    name="name"
                    defaultValue={c.name}
                    required
                    className={inputClass}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm" style={labelStyle}>
                    HubSpot List ID{" "}
                    <span style={{ color: "var(--text-muted)" }}>(ILS Segment ID, not Legacy)</span>
                  </label>
                  <input
                    name="hubspotListId"
                    defaultValue={c.hubspotListId}
                    required
                    className={inputClass}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm" style={labelStyle}>
                    Sequence label
                  </label>
                  <input
                    name="sequenceLabel"
                    defaultValue={c.sequenceLabel ?? ""}
                    className={inputClass}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm" style={labelStyle}>
                    Target count
                  </label>
                  <input
                    name="targetCount"
                    type="number"
                    defaultValue={c.targetCount ?? ""}
                    className={inputClass}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm" style={labelStyle}>
                    Owner name
                  </label>
                  <input
                    name="ownerName"
                    defaultValue={c.ownerName ?? ""}
                    className={inputClass}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm" style={labelStyle}>
                    Owner email
                  </label>
                  <input
                    name="ownerEmail"
                    type="email"
                    defaultValue={c.ownerEmail ?? ""}
                    className={inputClass}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm" style={labelStyle}>
                    Start date
                  </label>
                  <input
                    name="startDate"
                    type="date"
                    defaultValue={c.startDate ?? ""}
                    className={inputClass}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm" style={labelStyle}>
                    End date
                  </label>
                  <input
                    name="endDate"
                    type="date"
                    defaultValue={c.endDate ?? ""}
                    className={inputClass}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm" style={labelStyle}>
                    Status
                  </label>
                  <select
                    name="status"
                    defaultValue={c.status}
                    className={inputClass}
                    style={inputStyle}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div className="sm:col-span-2 flex items-center gap-2">
                  <button
                    type="submit"
                    className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                  >
                    Save changes
                  </button>
                </div>
              </form>

              <form action={deleteCampaign} className="mt-3">
                <input type="hidden" name="id" value={c.id} />
                <button
                  type="submit"
                  className="rounded border px-2 py-1 text-sm hover:bg-red-950"
                  style={{ borderColor: "var(--series-red)", color: "var(--series-red)" }}
                >
                  Delete campaign
                </button>
              </form>
            </details>
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
