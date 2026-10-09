import { getOwnersNotOnTeam, getTeamGroups, getTeamMembers } from "@/lib/team-queries";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings, owners, users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/session";
import {
  addTeamMember,
  createUser,
  updateUser,
  saveNotificationSettings,
  sendTestNotification,
  removeTeamMember,
  updateTeamMember,
} from "./actions";

export const dynamic = "force-dynamic";

const inputClass = "input";
const inputStyle = {};
const cardStyle = { background: "var(--chart-surface)", borderColor: "var(--border-hairline)" };
const labelStyle = { color: "var(--text-secondary)" };

export default async function SettingsPage() {
  const me = await requireAdmin();
  const [team, groups, availableOwners, userRows, allOwners, settingRows] = await Promise.all([
    getTeamMembers(),
    getTeamGroups(),
    getOwnersNotOnTeam(),
    db.select().from(users).orderBy(asc(users.name)),
    db.select().from(owners).orderBy(asc(owners.name)),
    db.select().from(appSettings),
  ]);
  const setting = (k: string) => settingRows.find((r) => r.key === k)?.value ?? null;
  const teamsUrl = (setting("teams_webhook_url") as string | null) ?? "";
  const emailFrom = (setting("email_from") as string | null) ?? "";
  const emailWins = (setting("email_wins") as boolean | null) ?? true;
  const withEmail = userRows.filter((u) => u.active && u.email).length;
  const resendReady = Boolean(process.env.RESEND_API_KEY);

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
              className="grid grid-cols-2 items-end gap-3 rounded border p-3 sm:grid-cols-7"
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
                  Email
                </label>
                <input name="email" type="email" defaultValue={u.email ?? ""} placeholder="for win emails" className={inputClass} style={inputStyle} />
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
        <form action={createUser} className="grid grid-cols-2 items-end gap-3 sm:grid-cols-7">
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
              Email
            </label>
            <input name="email" type="email" className={inputClass} style={inputStyle} />
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
        <h2 className="mb-2 text-lg font-medium">Live notifications</h2>
        <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
          Every meeting booked, BANT approved and goal hit is posted to Teams and emailed to every active login with an
          email ({withEmail} right now). The live feed and sounds on the Leaderboard work without any of this.
        </p>
        <form action={saveNotificationSettings} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs" style={labelStyle}>
              Teams webhook URL{" "}
              <span style={{ color: "var(--text-muted)" }}>
                (in the Teams chat: ⋯ → Workflows → &ldquo;Post to a chat when a webhook request is received&rdquo;)
              </span>
            </label>
            <input name="teamsWebhookUrl" defaultValue={teamsUrl} placeholder="https://…" className={inputClass} style={inputStyle} />
          </div>
          <div>
            <label className="mb-1 block text-xs" style={labelStyle}>
              Email from{" "}
              <span style={{ color: resendReady ? "var(--text-muted)" : "var(--status-warning)" }}>
                {resendReady ? "(Resend connected)" : "(Resend API key not set yet)"}
              </span>
            </label>
            <input
              name="emailFrom"
              defaultValue={emailFrom}
              placeholder="IWI Wins <wins@iwigroup.ca>"
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 pb-2 text-sm" style={labelStyle}>
              <input type="checkbox" name="emailWins" defaultChecked={emailWins} /> Email wins
            </label>
            <button type="submit" className="btn btn-primary px-4 py-2">
              Save
            </button>
            <button type="submit" formAction={sendTestNotification} className="btn px-4 py-2">
              Send test
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
    </div>
  );
}
