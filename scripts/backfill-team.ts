// One-off / occasional backfill of team performance data (the hourly sync only
// re-pulls the last 3 days of calls). Usage:
//   npx tsx scripts/backfill-team.ts 2026-01-01 [2026-10-08]
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { syncTeamCalls, syncTeamDeals } = await import("../lib/team-sync");
  const { todayInToronto } = await import("../lib/timezone");
  const from = process.argv[2];
  const to = process.argv[3] ?? todayInToronto();
  if (!from) throw new Error("usage: backfill-team.ts <fromDay> [toDay]");
  console.log(await syncTeamDeals(`${Number(to.slice(0, 4)) - 1}-01-01`));
  console.log(await syncTeamCalls(from, to, console.log));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
