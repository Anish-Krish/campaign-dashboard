import { NextResponse } from "next/server";
import { searchAll } from "@/lib/hubspot";
import { publishWins } from "@/lib/live";
import { syncTeamDealsByIds } from "@/lib/team-sync";

export const maxDuration = 60;

// The 1-minute backup to the HubSpot webhook (called by a Supabase pg_cron
// job): re-syncs any deal modified in the last few minutes — catches a
// missed webhook, a meeting associated after the deal was created, etc. —
// then publishes new wins. Usually finds nothing and costs one search call.
export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
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
  return NextResponse.json({ ok: true, deals: dealIds.length, wins: wins.length });
}
