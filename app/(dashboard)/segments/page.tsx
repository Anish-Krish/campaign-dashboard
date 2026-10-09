import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bdrCampaigns, segments, teamMembers } from "@/lib/db/schema";
import { requireUser } from "@/lib/session";
import { listContactLists } from "@/lib/hubspot";
import { todayInToronto } from "@/lib/timezone";
import { RegisterSegmentForm } from "@/components/segments/RegisterSegmentForm";
import { EditSegmentButton } from "@/components/segments/EditSegmentButton";
import { deleteSegment, registerSegment, setCampaignArchived, updateSegment } from "./actions";

export const dynamic = "force-dynamic";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (d: string) => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

export default async function SegmentsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const today = todayInToronto();

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
        contacted: sql<number>`(select count(*) from segment_leads l where l.segment_id = ${segments.id} and l.calls > 0)`.mapWith(Number),
      })
      .from(segments)
      .innerJoin(bdrCampaigns, eq(bdrCampaigns.id, segments.campaignId))
      .leftJoin(teamMembers, eq(teamMembers.hubspotOwnerId, segments.ownerId))
      .orderBy(asc(bdrCampaigns.name), desc(segments.startDate), asc(segments.listName)),
    db.select().from(teamMembers).orderBy(asc(teamMembers.name)),
    listContactLists().catch(() => []),
  ]);

  const registered = new Set(segRows.map((s) => s.hubspotListId));
  const availableLists = hubspotLists.filter((l) => !registered.has(l.listId));
  const activeCampaigns = campaigns.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name }));
  const visible = isAdmin ? segRows : segRows.filter((s) => s.ownerId === user.hubspotOwnerId);
  const canRegister = isAdmin || Boolean(user.hubspotOwnerId);
  const memberOptions = members.map((m) => ({ id: m.hubspotOwnerId, name: m.name }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Segments
        </h1>
        <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--text-muted)" }}>
          A segment is one HubSpot list a rep is calling inside a campaign. Register it with its start and end date — only the
          rep&apos;s calls and deals inside those dates count toward it.
        </p>
      </div>

      <section className="card p-5">
        <h2 className="mb-4 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Register a segment
        </h2>
        {canRegister ? (
          <RegisterSegmentForm
            action={registerSegment}
            lists={availableLists}
            campaigns={activeCampaigns}
            members={memberOptions}
            isAdmin={isAdmin}
          />
        ) : (
          <p className="text-sm" style={{ color: "var(--status-warning)" }}>
            Your login isn&apos;t linked to a HubSpot user yet — ask an admin to link it in Settings.
          </p>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="px-5 pt-4 pb-2">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {isAdmin ? "All segments" : "Your segments"}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Segment</th>
                <th style={{ textAlign: "left" }}>Rep</th>
                <th style={{ textAlign: "left" }}>Dates</th>
                <th style={{ textAlign: "left" }}>Status</th>
                <th>Leads</th>
                <th style={{ textAlign: "left", width: 200 }}>Contacted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>
                    No segments registered yet.
                  </td>
                </tr>
              )}
              {visible.map((s) => {
                const running = !s.endDate || s.endDate >= today;
                const pct = s.leads > 0 ? Math.round((s.contacted / s.leads) * 100) : 0;
                return (
                  <tr key={s.id}>
                    <td>
                      <div className="font-medium" style={{ color: "var(--text-primary)" }}>
                        {s.listName}
                      </div>
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {s.campaignName}
                      </div>
                    </td>
                    <td style={{ textAlign: "left" }}>{s.rep ?? s.ownerId}</td>
                    <td style={{ textAlign: "left" }}>
                      {shortDay(s.startDate)} → {s.endDate ? shortDay(s.endDate) : "ongoing"}
                    </td>
                    <td style={{ textAlign: "left" }}>
                      {!s.lastSyncedAt ? (
                        <span className="pill" style={{ ["--dot" as string]: "var(--text-muted)" }}>
                          Syncing
                        </span>
                      ) : running ? (
                        <span className="pill" style={{ ["--dot" as string]: "var(--status-good)" }}>
                          Running
                        </span>
                      ) : (
                        <span className="pill">Ended</span>
                      )}
                    </td>
                    <td>{s.leads.toLocaleString()}</td>
                    <td style={{ textAlign: "left" }}>
                      <div className="flex items-center gap-3">
                        <div className="h-1.5 flex-1 rounded-full" style={{ background: "var(--surface-2)" }}>
                          <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: "var(--accent)" }} />
                        </div>
                        <span className="w-10 text-right text-xs">{pct}%</span>
                      </div>
                    </td>
                    <td>
                      <EditSegmentButton
                        seg={{
                          id: s.id,
                          listName: s.listName,
                          campaignId: s.campaignId,
                          ownerId: s.ownerId,
                          startDate: s.startDate,
                          endDate: s.endDate,
                        }}
                        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name, archived: c.archived }))}
                        members={memberOptions}
                        isAdmin={isAdmin}
                        updateAction={updateSegment}
                        deleteAction={deleteSegment}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {isAdmin && campaigns.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Campaigns
          </h2>
          <ul className="divide-y text-sm" style={{ borderColor: "var(--gridline)" }}>
            {campaigns.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2.5" style={{ borderColor: "var(--gridline)" }}>
                <span style={{ color: c.archived ? "var(--text-muted)" : "var(--text-primary)" }}>
                  {c.name}
                  <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    {segRows.filter((s) => s.campaignId === c.id).length} segments
                    {c.archived ? " · archived" : ""}
                  </span>
                </span>
                <form action={setCampaignArchived}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="archived" value={String(!c.archived)} />
                  <button type="submit" className="btn px-2.5 py-1">
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
