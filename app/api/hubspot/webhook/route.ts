import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { publishWins } from "@/lib/live";
import { syncTeamDealsByIds } from "@/lib/team-sync";

export const maxDuration = 60;

// HubSpot private-app webhook: deal created / BANT ticked / Source Group set.
// Answers HubSpot straight away, then re-syncs just those deals and publishes
// any new wins (feed, sounds, Teams, email) in the background.
//
// Signature v3: base64(HMAC-SHA256(client secret, method + url + body +
// timestamp)), rejected if older than 5 minutes.
function validSignature(request: Request, body: string): boolean {
  const secret = process.env.HUBSPOT_WEBHOOK_SECRET;
  const signature = request.headers.get("x-hubspot-signature-v3");
  const timestamp = request.headers.get("x-hubspot-request-timestamp");
  if (!secret || !signature || !timestamp) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) return false;
  const expected = createHmac("sha256", secret)
    .update(`POST${decodeURIComponent(request.url)}${body}${timestamp}`)
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const body = await request.text();
  if (!validSignature(request, body)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let events: { objectId?: number; subscriptionType?: string }[] = [];
  try {
    events = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }
  const dealIds = [
    ...new Set(events.filter((e) => e.subscriptionType?.startsWith("deal.") && e.objectId).map((e) => String(e.objectId))),
  ];

  if (dealIds.length > 0) {
    after(async () => {
      try {
        await syncTeamDealsByIds(dealIds);
        await publishWins();
      } catch (err) {
        console.error("[hubspot-webhook] failed", dealIds, err);
      }
    });
  }
  return NextResponse.json({ ok: true, deals: dealIds.length });
}
