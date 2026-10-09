import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings, liveEvents, teamMembers, users } from "@/lib/db/schema";
import { activeReps, getGoals } from "@/lib/goals";
import { ALL_BDRS, getTeamStats } from "@/lib/team-queries";
import { todayInToronto } from "@/lib/timezone";

// Live wins, per the user: a BDR books a meeting -> "ding"; BANT approved ->
// big celebration; a rep or the team hits the monthly BANT goal ->
// celebration. Each fires once (dedupe_key), shows up in the in-app feed, and
// is posted to Teams + emailed to every login with an email.
//
// Detection is state-based rather than diffing: after any sync, every deal
// that IS a BDR booking with a meeting gets a "meeting:<id>" event if it
// doesn't have one yet — but only for recent bookings, so turning this on (or
// a backfill) never floods the feed with history.

const RECENT = sql.raw(`interval '2 days'`);

export type LiveEvent = typeof liveEvents.$inferSelect;

export async function detectWins(): Promise<LiveEvent[]> {
  const created: LiveEvent[] = [];

  const meetings = await db.execute<{ id: number }>(sql`
    insert into live_events (kind, dedupe_key, owner_id, deal_id, title, body)
    select 'meeting', 'meeting:' || d.hubspot_deal_id, d.booked_by_owner_id, d.hubspot_deal_id,
      coalesce(tm.name, 'A rep') || ' booked a meeting',
      regexp_replace(coalesce(d.deal_name, ''), ' - New Deal$', '')
    from team_deals d
    left join team_members tm on tm.hubspot_owner_id = d.booked_by_owner_id
    where d.source_group = 'BDR' and d.meeting_status <> 'no_meeting'
      and d.created_at >= now() - ${RECENT}
    on conflict (dedupe_key) do nothing
    returning id
  `);
  const bants = await db.execute<{ id: number }>(sql`
    insert into live_events (kind, dedupe_key, owner_id, deal_id, title, body)
    select 'bant', 'bant:' || d.hubspot_deal_id, d.booked_by_owner_id, d.hubspot_deal_id,
      'BANT meeting for ' || coalesce(tm.name, 'a rep') || '!',
      regexp_replace(coalesce(d.deal_name, ''), ' - New Deal$', '')
    from team_deals d
    left join team_members tm on tm.hubspot_owner_id = d.booked_by_owner_id
    where d.source_group = 'BDR' and d.bant and d.bant_date >= (now() at time zone 'America/Toronto')::date - 1
    on conflict (dedupe_key) do nothing
    returning id
  `);
  const ids = [...meetings, ...bants].map((r) => Number(r.id));
  if (ids.length > 0) created.push(...(await db.select().from(liveEvents).where(inArray(liveEvents.id, ids))));

  created.push(...(await detectGoalHits()));
  return created.sort((a, b) => a.id - b.id);
}

// This month's BANT goal, team and each rep — fires once per month each.
async function detectGoalHits(): Promise<LiveEvent[]> {
  const today = todayInToronto();
  const month = today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const range = { startDate: `${month}-01`, endDate: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
  const members = await db.select().from(teamMembers);
  const goals = await getGoals(range, members);
  if (goals.team == null) return [];
  const stats = await getTeamStats(range, { group: ALL_BDRS }, "activity");
  const reps = activeReps(members, range);

  const hits: { key: string; ownerId: string | null; title: string; body: string }[] = [];
  if (goals.team > 0 && stats.total.bant >= goals.team) {
    hits.push({ key: `goal:team:${month}`, ownerId: null, title: "Team hit the BANT goal! 🎯", body: `${stats.total.bant} BANT meetings this month` });
  }
  for (const r of stats.reps) {
    const goal = goals.byRep.get(r.ownerId);
    if (!reps.some((m) => m.hubspotOwnerId === r.ownerId) || !goal || goal <= 0 || r.bant < goal) continue;
    hits.push({ key: `goal:${r.ownerId}:${month}`, ownerId: r.ownerId, title: `${r.name} hit their BANT goal! 🎯`, body: `${r.bant} BANT meetings this month` });
  }
  if (hits.length === 0) return [];
  return db
    .insert(liveEvents)
    .values(hits.map((h) => ({ kind: "goal", dedupeKey: h.key, ownerId: h.ownerId, title: h.title, body: h.body })))
    .onConflictDoNothing({ target: liveEvents.dedupeKey })
    .returning();
}

// --- Notifications ------------------------------------------------------------------

export async function setting<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return (row?.value as T) ?? null;
}

const EMOJI: Record<string, string> = { meeting: "📅", bant: "🔥", goal: "🎯" };
export const appUrl = () => process.env.APP_URL ?? "https://campaign-dashboard-brown-two.vercel.app";

async function postToTeams(url: string, e: LiveEvent) {
  // Teams "Workflows" webhook ("Post to a chat/channel when a webhook request
  // is received") takes an Adaptive Card wrapped in a message.
  const card = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            { type: "TextBlock", size: e.kind === "meeting" ? "Medium" : "Large", weight: "Bolder", wrap: true, text: `${EMOJI[e.kind] ?? ""} ${e.title}` },
            ...(e.body ? [{ type: "TextBlock", wrap: true, isSubtle: true, text: e.body }] : []),
          ],
          actions: [{ type: "Action.OpenUrl", title: "Open leaderboard", url: `${appUrl()}/team?scope=rep` }],
        },
      },
    ],
  };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(card) });
  if (!res.ok) throw new Error(`Teams ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// One email through Resend, from the Settings "Email from" address (Resend's
// test sender until iwigroup.ca is verified there).
export async function sendMail(to: string[], subject: string, html: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not set");
  if (to.length === 0) return;
  const from = (await setting<string>("email_from")) ?? "IWI Wins <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function sendEmail(to: string[], e: LiveEvent) {
  if (!process.env.RESEND_API_KEY || to.length === 0) return;
  const html = `<div style="font-family:system-ui,sans-serif;padding:8px">
    <h2 style="margin:0 0 6px">${EMOJI[e.kind] ?? ""} ${escapeHtml(e.title)}</h2>
    ${e.body ? `<p style="margin:0 0 14px;color:#555">${escapeHtml(e.body)}</p>` : ""}
    <a href="${appUrl()}/team?scope=rep" style="color:#2f6fd0">Open the leaderboard</a></div>`;
  await sendMail(to, `${EMOJI[e.kind] ?? ""} ${e.title}`, html);
}

// Sends every win from the last day not yet notified. Chat messages stay in
// the app.
export async function notifyPending() {
  const pending = await db
    .select()
    .from(liveEvents)
    .where(and(isNull(liveEvents.notifiedAt), sql`${liveEvents.kind} <> 'chat'`, sql`${liveEvents.createdAt} >= now() - interval '1 day'`))
    .orderBy(liveEvents.id);
  if (pending.length === 0) return { sent: 0 };

  const teamsUrl = await setting<string>("teams_webhook_url");
  const emailOn = (await setting<boolean>("email_wins")) ?? true;
  const recipients = emailOn
    ? (await db.select({ email: users.email }).from(users).where(and(eq(users.active, true), isNotNull(users.email))))
        .map((u) => u.email!)
        .filter((e) => /.+@.+\..+/.test(e))
    : [];

  let sent = 0;
  for (const e of pending) {
    const errors: string[] = [];
    if (teamsUrl) await postToTeams(teamsUrl, e).catch((err) => errors.push(String(err)));
    if (recipients.length) await sendEmail(recipients, e).catch((err) => errors.push(String(err)));
    if (errors.length) console.error("[live] notify failed", e.id, errors.join("; "));
    // mark done either way so one bad webhook URL can't re-send forever
    await db.update(liveEvents).set({ notifiedAt: new Date() }).where(eq(liveEvents.id, e.id));
    sent++;
  }
  return { sent };
}

// The full live step after any sync: find new wins, then tell people.
export async function publishWins() {
  const events = await detectWins();
  await notifyPending();
  return events;
}
