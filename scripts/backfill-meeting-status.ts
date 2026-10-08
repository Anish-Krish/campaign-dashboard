// One-time: write Intro Meeting Status = Held onto BDR-sourced deals where the
// dashboard is already certain the intro happened (meeting marked Completed,
// or the deal reached Pre-Assessment / SQL) and nobody has set a status yet.
// Usage: npx tsx scripts/backfill-meeting-status.ts 2026-09-01 [--apply]
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db } = await import("../lib/db");
  const { sql } = await import("drizzle-orm");
  const { batchUpdateObjects } = await import("../lib/hubspot");
  const from = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!from) throw new Error("usage: backfill-meeting-status.ts <fromDay> [--apply]");

  const rows = await db.execute<{ id: string; deal_name: string }>(sql`
    select hubspot_deal_id id, deal_name from team_deals
    where created_at >= ${from}::date
      and source_group = 'BDR'
      and meeting_status = 'held' and status_source = 'auto'
    order by created_at`);
  for (const r of rows) console.log(`  ${r.id}  ${r.deal_name}`);
  console.log(`${rows.length} deals ${apply ? "-> writing Held" : "(dry run, pass --apply to write)"}`);
  if (apply && rows.length > 0) {
    await batchUpdateObjects("deals", rows.map((r) => ({ id: r.id, properties: { intro_meeting_status: "held" } })));
    console.log("done");
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
