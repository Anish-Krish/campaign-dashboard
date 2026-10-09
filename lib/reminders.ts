import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { outcomeReminders } from "@/lib/db/schema";
import { batchReadObjects, hubspotDealUrl } from "@/lib/hubspot";
import { appUrl, escapeHtml, sendMail, setting } from "@/lib/live";

// Outcome reminders (per the user): an hour after an intro meeting's start
// time, if its HubSpot Meeting Outcome is still blank / Scheduled, email the
// BDR who booked it to set it (Completed, No show, Canceled, Rescheduled) —
// so nothing sits with no status. Runs on the 1-minute tick; each meeting is
// chased once (outcome_reminders). The outcome is read live from HubSpot
// right before sending, since a BDR editing a meeting doesn't touch the deal
// (no webhook), so the synced copy can be stale.

const OPEN = new Set(["", "SCHEDULED"]);

export async function sendOutcomeReminders() {
  if ((await setting<boolean>("outcome_reminders")) === false) return { sent: 0 };

  // Started 1–6 hours ago (the cap keeps a first run or an outage from
  // emailing about old meetings), BDR booking by a current rep, not chased yet.
  const due = await db.execute<{
    meeting_id: string;
    deal_id: string;
    deal_name: string | null;
    owner_id: string;
    rep: string;
    email: string | null;
  }>(sql`
    select m.meeting_id, m.deal_id, d.deal_name, d.booked_by_owner_id as owner_id, tm.name as rep,
      coalesce((select u.email from users u where u.hubspot_owner_id = d.booked_by_owner_id and u.active and u.email is not null limit 1),
               (select o.email from owners o where o.hubspot_owner_id = d.booked_by_owner_id)) as email
    from team_intro_meetings m
    join team_deals d on d.hubspot_deal_id = m.deal_id
    join team_members tm on tm.hubspot_owner_id = d.booked_by_owner_id
    where d.source_group = 'BDR'
      and (tm.end_date is null or tm.end_date >= current_date)
      and m.meeting_at between (now() at time zone 'UTC') - interval '6 hours' and (now() at time zone 'UTC') - interval '1 hour'
      and not exists (select 1 from outcome_reminders r where r.meeting_id = m.meeting_id)
  `);
  if (due.length === 0) return { sent: 0 };

  const live = await batchReadObjects<{ hs_meeting_outcome?: string; hs_meeting_title?: string; hs_timestamp?: string }>(
    "meetings",
    due.map((d) => d.meeting_id),
    ["hs_meeting_outcome", "hs_meeting_title", "hs_timestamp"],
  );
  const byId = new Map(live.map((m) => [m.id, m.properties]));

  let sent = 0;
  for (const d of due) {
    const m = byId.get(d.meeting_id);
    const startMs = Date.parse(m?.hs_timestamp ?? "");
    // moved to later — check again once the new time has passed
    if (m && startMs > Date.now() - 60 * 60 * 1000) continue;
    const outcome = (m?.hs_meeting_outcome ?? "").toUpperCase();
    let sentTo: string | null = null;
    let error: string | null = null;
    if (!m) error = "meeting deleted";
    else if (!OPEN.has(outcome)) error = `outcome already ${outcome}`;
    else if (!d.email) error = "no email for rep";
    else {
      const company = (d.deal_name ?? "your meeting").replace(/ - New Deal$/, "");
      const when = new Date(startMs).toLocaleString("en-CA", {
        timeZone: "America/Toronto",
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      });
      const html = `<div style="font-family:system-ui,sans-serif;padding:8px;line-height:1.5">
        <p style="margin:0 0 10px">Hi ${escapeHtml(d.rep.split(" ")[0])},</p>
        <p style="margin:0 0 10px">Your meeting <b>${escapeHtml(m.hs_meeting_title ?? company)}</b> (${escapeHtml(when)}) has no outcome yet.
        Please set the <b>Meeting outcome</b> in HubSpot so the dashboard is right:</p>
        <ul style="margin:0 0 12px;padding-left:18px">
          <li><b>Completed</b> — it happened</li>
          <li><b>No show</b> or <b>Canceled</b> — it needs a rebook</li>
          <li><b>Rescheduled</b> — you already booked the new time</li>
        </ul>
        <p style="margin:0 0 6px"><a href="${hubspotDealUrl(d.deal_id)}" style="color:#2f6fd0">Open the deal in HubSpot</a>
        &nbsp;·&nbsp; <a href="${appUrl()}/team?scope=follow" style="color:#2f6fd0">Your follow-ups</a></p></div>`;
      try {
        await sendMail([d.email], `Set the outcome: ${company}`, html);
        sentTo = d.email;
        sent++;
      } catch (err) {
        error = String(err).slice(0, 300);
      }
    }
    await db
      .insert(outcomeReminders)
      .values({ meetingId: d.meeting_id, dealId: d.deal_id, ownerId: d.owner_id, sentTo, error })
      .onConflictDoNothing();
  }
  return { sent };
}
