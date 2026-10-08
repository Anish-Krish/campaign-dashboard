import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bdrCampaigns, segments, teamMembers } from "@/lib/db/schema";
import { requireUser } from "@/lib/session";
import { listContactLists } from "@/lib/hubspot";
import { deleteSegment, registerSegment, setCampaignArchived, updateSegment } from "./actions";

export const dynamic = "force-dynamic";

const inputClass = "w-full rounded border bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500";
const inputStyle = { borderColor: "var(--border-hairline)", color: "var(--text-primary)", background: "var(--background)" };
const cardStyle = { background: "var(--chart-surface)", borderColor: "var(--border-hairline)" };
const labelStyle = { color: "var(--text-secondary)" };

export default async function SegmentsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "admin";

  const [campaigns, segRows, members, hubspotLists] = await Promise.all([
    db.select().from(bdrCampaigns).orderBy(asc(bdrCampaigns.archived), asc(bdrCampaigns.name)),
    db
      .select({
        id: segments.id,
        campaignId: segments.campaignId,
        campaignName: bdrCampaigns.name,
        listName: segments.listName,
        hubspotListId: segments.hubspotListId,
        ownerId: segments.ownerId,
        rep: teamMembers.name,
        startDate: segments.startDate,
        endDate: segments.endDate,
        lastSyncedAt: segments.lastSyncedAt,
        leads: sql<number>`(select count(*) from segment_leads l where l.segment_id = ${segments.id})`.mapWith(Number),
      })
      .from(segments)
      .innerJoin(bdrCampaigns, eq(bdrCampaigns.id, segments.campaignId))
      .leftJoin(teamMembers, eq(teamMembers.hubspotOwnerId, segments.ownerId))
      .orderBy(asc(bdrCampaigns.name), desc(segments.startDate)),
    db.select().from(teamMembers).orderBy(asc(teamMembers.name)),
    listContactLists().catch(() => []),
  ]);

  const registered = new Set(segRows.map((s) => s.hubspotListId));
  const availableLists = hubspotLists.filter((l) => !registered.has(l.listId));
  const activeCampaigns = campaigns.filter((c) => !c.archived);
  const visibleSegments = isAdmin ? segRows : segRows.filter((s) => s.ownerId === user.hubspotOwnerId);
  const canRegister = isAdmin || Boolean(user.hubspotOwnerId);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Segments</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          A segment is one HubSpot list you&apos;re calling inside a campaign. Register each list with its start and end date —
          only your calls and deals inside those dates count toward it.
        </p>
      </div>

      <section className="rounded-lg border p-5" style={cardStyle}>
        <h2 className="mb-4 text-lg font-medium">Register a segment</h2>
        {!canRegister ? (
          <p className="text-sm" style={{ color: "var(--status-warning)" }}>
            Your login isn&apos;t linked to a HubSpot user yet — ask an admin to link it in Settings.
          </p>
        ) : (
          <form action={registerSegment} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm" style={labelStyle}>
                HubSpot list
              </label>
              <select name="listId" required defaultValue="" className={inputClass} style={inputStyle}>
                <option value="" disabled>
                  Choose a contact list…
                </option>
                {availableLists.map((l) => (
                  <option key={l.listId} value={l.listId}>
                    {l.name}
                    {l.size != null ? ` — ${l.size} contacts` : ""}
                    {l.createdAt ? ` (created ${l.createdAt.slice(0, 10)})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm" style={labelStyle}>
                Campaign
              </label>
              <select name="campaignId" defaultValue={activeCampaigns[0]?.id ?? ""} className={inputClass} style={inputStyle}>
                {activeCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm" style={labelStyle}>
                …or start a new campaign
              </label>
              <input name="newCampaign" placeholder="e.g. Manufacturing X3 Canada" className={inputClass} style={inputStyle} />
            </div>
            {isAdmin && (
              <div>
                <label className="mb-1 block text-sm" style={labelStyle}>
                  Rep
                </label>
                <select name="ownerId" required defaultValue="" className={inputClass} style={inputStyle}>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {members.map((m) => (
                    <option key={m.hubspotOwnerId} value={m.hubspotOwnerId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm" style={labelStyle}>
                Start date
              </label>
              <input name="startDate" type="date" required className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className="mb-1 block text-sm" style={labelStyle}>
                End date <span style={{ color: "var(--text-muted)" }}>(blank = still running)</span>
              </label>
              <input name="endDate" type="date" className={inputClass} style={inputStyle} />
            </div>
            <div className="sm:col-span-2">
              <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">
                Register segment
              </button>
              <span className="ml-3 text-xs" style={{ color: "var(--text-muted)" }}>
                Numbers fill in within about a minute.
              </span>
            </div>
          </form>
        )}
      </section>

      <section className="rounded-lg border p-5" style={cardStyle}>
        <h2 className="mb-4 text-lg font-medium">{isAdmin ? "All segments" : "Your segments"}</h2>
        <div className="space-y-3">
          {visibleSegments.length === 0 && <p style={{ color: "var(--text-muted)" }}>No segments registered yet.</p>}
          {visibleSegments.map((s) => (
            <details key={s.id} className="rounded border p-3" style={{ borderColor: "var(--gridline)" }}>
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                <span>
                  <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                    {s.listName}
                  </span>
                  <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    {s.campaignName} · {s.rep ?? s.ownerId} · {s.startDate} → {s.endDate ?? "ongoing"} · {s.leads} leads
                    {s.lastSyncedAt ? "" : " · syncing…"}
                  </span>
                </span>
              </summary>
              <form action={updateSegment} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
                <input type="hidden" name="id" value={s.id} />
                <div>
                  <label className="mb-1 block text-xs" style={labelStyle}>
                    Campaign
                  </label>
                  <select name="campaignId" defaultValue={s.campaignId} className={inputClass} style={inputStyle}>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.archived ? " (archived)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                {isAdmin && (
                  <div>
                    <label className="mb-1 block text-xs" style={labelStyle}>
                      Rep
                    </label>
                    <select name="ownerId" defaultValue={s.ownerId} className={inputClass} style={inputStyle}>
                      {members.map((m) => (
                        <option key={m.hubspotOwnerId} value={m.hubspotOwnerId}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs" style={labelStyle}>
                    Start
                  </label>
                  <input name="startDate" type="date" required defaultValue={s.startDate} className={inputClass} style={inputStyle} />
                </div>
                <div>
                  <label className="mb-1 block text-xs" style={labelStyle}>
                    End
                  </label>
                  <input name="endDate" type="date" defaultValue={s.endDate ?? ""} className={inputClass} style={inputStyle} />
                </div>
                <div className="flex gap-2 sm:col-span-4">
                  <button type="submit" className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500">
                    Save
                  </button>
                  <button
                    type="submit"
                    formAction={deleteSegment}
                    className="rounded border px-3 py-2 text-sm hover:bg-red-950"
                    style={{ borderColor: "var(--series-red)", color: "var(--series-red)" }}
                  >
                    Remove segment
                  </button>
                </div>
              </form>
            </details>
          ))}
        </div>
      </section>

      {isAdmin && campaigns.length > 0 && (
        <section className="rounded-lg border p-5" style={cardStyle}>
          <h2 className="mb-4 text-lg font-medium">Campaigns</h2>
          <ul className="space-y-2 text-sm">
            {campaigns.map((c) => (
              <li key={c.id} className="flex items-center justify-between">
                <span style={{ color: c.archived ? "var(--text-muted)" : "var(--text-primary)" }}>
                  {c.name}
                  {c.archived ? " (archived)" : ""}
                </span>
                <form action={setCampaignArchived}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="archived" value={String(!c.archived)} />
                  <button type="submit" className="hud-button rounded px-2 py-1 text-xs">
                    {c.archived ? "Unarchive" : "Archive"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
