import { NextResponse } from "next/server";
import { searchAll } from "@/lib/hubspot";
import { publishWins } from "@/lib/live";
import { syncTeamDealsByIds } from "@/lib/team-sync";
import { sendOutcomeReminders } from "@/lib/reminders";

export const maxDuration = 60;

// The 1-minute backup to the HubSpot webhook (called by a Supabase pg_cron
// job): re-syncs any deal modified in the last few minutes — catches a
// missed webhook, a meeting associated after the deal was created, etc. —
// then publishes new wins and sends any due meeting-outcome reminders. Usually finds nothing and costs one search call.
export async function GET(request: Request) {
  // LIVE_TICK_SECRET is what the pg_cron job sends (its own secret, so the
  // hourly sync's CRON_SECRET never has to live in the database).
  const secret = process.env.LIVE_TICK_SECRET ?? process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const since = String(Date.now() - 4 * 60 * 1000);
  const { results } = await searchAll<{ dealname?: string }>(
    "deals",
    [{ propertyName: "hs_lastmodifieddate", operator: "GTE", value: since }],
    ["dealname"],
  );
  const dealIds = results.map((d) => d.id);
  if (dealIds.length > 0) await syncTeamDealsByIds(dealIds);
  const wins = await publishWins();
  // a reminder failure must never break the live wins
  const reminders = await sendOutcomeReminders().catch((err) => {
    console.error("[live] outcome reminders failed", err);
    return { sent: 0 };
  });
  return NextResponse.json({ ok: true, deals: dealIds.length, wins: wins.length, reminders: reminders.sent });
}
