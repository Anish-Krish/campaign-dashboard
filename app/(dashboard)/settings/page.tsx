import { getAuthorityKeywords } from "@/lib/authority";
import { getCampaignsWithCounts } from "@/lib/queries";
import { getOwnersNotOnTeam, getTeamGroups, getTeamMembers } from "@/lib/team-queries";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { owners, users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/session";
import {
  addTeamMember,
  createUser,
  updateUser,
  createCampaign,
  deleteCampaign,
  removeTeamMember,
  saveAuthorityKeywords,
  updateCampaign,
  updateTeamMember,
} from "./actions";

export const dynamic = "force-dynamic";

const inputClass = "input";
const inputStyle = {};
const cardStyle = { background: "var(--chart-surface)", borderColor: "var(--border-hairline)" };
const labelStyle = { color: "var(--text-secondary)" };

export default async function SettingsPage() {
  const me = await requireAdmin();
  const [campaigns, keywords, team, groups, availableOwners, userRows, allOwners] = await Promise.all([
    getCampaignsWithCounts(),
    getAuthorityKeywords(),
    getTeamMembers(),
    getTeamGroups(),
    getOwnersNotOnTeam(),
    db.select().from(users).orderBy(asc(users.name)),
    db.select().from(owners).orderBy(asc(owners.name)),
  ]);

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="rounded-lg border p-5" style={cardStyle}>
        <h2 className="mb-2 text-lg font-medium">Logins</h2>
        <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
          One login per person. BDRs see the Team page and register their own segments (link them to their HubSpot user so
          their registrations are attributed to them). Admins see everything. Leave the password blank to keep it.
        </p>
        <div className="mb-6 space-y-3">
          {userRows.map((u) => (
            <form
              key={u.id}
              action={updateUser}
              className="grid grid-cols-2 items-end gap-3 rounded border p-3 sm:grid-cols-6"
              style={{ borderColor: "var(--gridline)" }}
            >
              <input type="hidden" name="id" value={u.id} />
              <div>
                <label className="mb-1 block text-xs" style={labelStyle}>
                  Name · login <span style={{ color: "var(--text-primary)" }}>{u.username}</span>
                </label>
                <input name="name" defaultValue={u.name} className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label className="mb-1 block text-xs" style={labelStyle}>
                  Role
                </label>
                <select name="role" defaultValue={u.role} className={inputClass} style={inputStyle}>
                  <option value="bdr">BDR</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs" style={labelStyle}>
                  HubSpot user
                </label>
                <select name="hubspotOwnerId" defaultValue={u.hubspotOwnerId ?? ""} className={inputClass} style={inputStyle}>
                  <option value="">— none —</option>
                  {allOwners.map((o) => (
                    <option key={o.hubspotOwnerId} value={o.hubspotOwnerId}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs" style={labelStyle}>
                  New password
                </label>
                <input name="password" type="password" autoComplete="new-password" className={inputClass} style={inputStyle} />
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1 text-xs" style={labelStyle}>
                  <input type="checkbox" name="active" defaultChecked={u.active} disabled={u.id === me.id} /> Active
                </label>
                <button type="submit" className="btn btn-primary px-3 py-2">
                  Save
                </button>
              </div>
            </form>
          ))}
        </div>
        <form action={createUser} className="grid grid-cols-2 items-end gap-3 sm:grid-cols-6">
          <div>
            <label className="mb-1 block text-xs" style={labelStyle}>
              Username
            </label>
            <input name="username" required className={inputClass} style={inputStyle} />
          </div>
          <div>
            <label className="mb-1 block text-xs" style={labelStyle}>
              Name
            </label>
            <input name="name" required className={inputClass} style={inputStyle} />
          </div>
          <div>
            <label className="mb-1 block text-xs" style={labelStyle}>
              Role
            </label>
            <select name="role" defaultValue="bdr" className={inputClass} style={inputStyle}>
              <option value="bdr">BDR</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs" style={labelStyle}>
              HubSpot user
            </label>
            <select name="hubspotOwnerId" defaultValue="" className={inputClass} style={inputStyle}>
              <option value="">— none —</option>
              {allOwners.map((o) => (
                <option key={o.hubspotOwnerId} value={o.hubspotOwnerId}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs" style={labelStyle}>
              Temp password
            </label>
            <input name="password" required className={inputClass} style={inputStyle} />
          </div>
          <div>
            <button type="submit" className="btn btn-primary px-4 py-2">
              Create login
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border p-5" style={cardStyle}>
        <h2 className="mb-2 text-lg font-medium">Team</h2>
        <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
          Who shows up on the Team page. Each group gets its own leaderboard — put trial reps for a
          competition in their own group (e.g. &ldquo;Trial – Nov 2026&rdquo;). A rep must be a HubSpot
          user so their calls and deals carry their owner ID; history appears as soon as they&apos;re added.
        </p>

        <datalist id="team-groups">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>

        <div className="mb-6 space-y-3">
          {team.length === 0 && <p style={{ color: "var(--text-muted)" }}>No team members yet.</p>}
          {team.map((m) => (
            <form
              key={m.hubspotOwnerId}
              action={updateTeamMember}
              className="grid grid-cols-2 items-end gap-3 rounded border p-3 sm:grid-cols-6"
              style={{ borderColor: "var(--gridline)" }}
            >
              <input type="hidden" name="ownerId" value={m.hubspotOwnerId} />
              <div className="col-span-2 sm:col-span-1">
                <label className="mb-1 block text-xs" style={labelStyle}>
                  Name
                </label>
                <input name="name" defaultValue={m.name} required className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label className="mb-1 block text-xs" style={labelStyle}>
                  Role
                </label>
                <select name="role" defaultValue={m.role} className={inputClass} style={inputStyle}>
                  <option value="bdr">BDR</option>
                  <option value="ae">AE</option>
                  <option value="manager">Manager</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs" style={labelStyle}>
                  Group
                </label>
                <input name="teamGroup" list="team-groups" defaultValue={m.teamGroup} className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label className="mb-1 block text-xs" style={labelStyle}>
                  Start
                </label>
                <input name="startDate" type="date" defaultValue={m.startDate ?? ""} className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label className="mb-1 block text-xs" style={labelStyle}>
                  End
                </label>
                <input name="endDate" type="date" defaultValue={m.endDate ?? ""} className={inputClass} style={inputStyle} />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="btn btn-primary px-3 py-2">
                  Save
                </button>
                <button
                  type="submit"
                  formAction={removeTeamMember}
                  className="rounded border px-3 py-2 text-sm hover:bg-red-950"
                  style={{ borderColor: "var(--series-red)", color: "var(--series-red)" }}
                >
                  Remove
                </button>
              </div>
            </form>
          ))}
        </div>

        <form action={addTeamMember} className="grid grid-cols-2 items-end gap-3 sm:grid-cols-6">
          <div className="col-span-2">
            <label className="mb-1 block text-xs" style={labelStyle}>
              Add HubSpot user
            </label>
            <select name="ownerId" required className={inputClass} style={inputStyle} defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {availableOwners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.email ? ` (${o.email})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs" style={labelStyle}>
              Role
            </label>
            <select name="role" defaultValue="bdr" className={inputClass} style={inputStyle}>
              <option value="bdr">BDR</option>
              <option value="ae">AE</option>
              <option value="manager">Manager</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs" style={labelStyle}>
              Group
            </label>
            <input name="teamGroup" list="team-groups" defaultValue="Core BDRs" className={inputClass} style={inputStyle} />
          </div>
          <div>
            <label className="mb-1 block text-xs" style={labelStyle}>
              Start
            </label>
            <input name="startDate" type="date" className={inputClass} style={inputStyle} />
          </div>
          <div>
            <button type="submit" className="btn btn-primary px-4 py-2">
              Add to team
            </button>
          </div>
        </form>
      </section>

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
              className="btn btn-primary px-4 py-2"
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
                    className="btn btn-primary px-4 py-2"
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
            className="btn btn-primary px-4 py-2 sm:self-start"
          >
            Save
          </button>
        </form>
      </section>
    </div>
  );
}
