import { and, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { goals, teamMembers } from "@/lib/db/schema";
import type { DateRange } from "@/lib/team-queries";

// Goals are monthly BANT-meeting targets (per the user — BANT meetings set is
// what commission is paid on). The admin sets a team goal per month; each
// leaderboard rep active that month gets an even share, unless the admin
// overrides their number — then the rest of the team goal is split evenly
// across the others. A period that isn't one whole month adds the months up,
// pro-rated by the days of each month it covers.

type Member = typeof teamMembers.$inferSelect;

// Leaderboard reps: BDRs whose start/end dates overlap the range.
export function activeReps(members: Member[], range: DateRange): Member[] {
  return members.filter(
    (m) =>
      m.role === "bdr" &&
      (!m.startDate || m.startDate <= range.endDate) &&
      (!m.endDate || m.endDate >= range.startDate),
  );
}

function monthsIn(range: DateRange): { month: string; fraction: number }[] {
  const out: { month: string; fraction: number }[] = [];
  for (let m = range.startDate.slice(0, 7); m <= range.endDate.slice(0, 7); ) {
    const [y, mo] = m.split("-").map(Number);
    const first = `${m}-01`;
    const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    const from = first < range.startDate ? range.startDate : first;
    const to = last > range.endDate ? range.endDate : last;
    const days = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000 + 1;
    out.push({ month: m, fraction: days(from, to) / days(first, last) });
    m = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7);
  }
  return out;
}

export type GoalSet = {
  team: number | null; // null = no goal set for any month in the range
  byRep: Map<string, number>;
  // per month, for the editor: team target and explicit overrides
  monthTeam: number | null;
  monthOverrides: Map<string, number>;
  monthShares: Map<string, number>; // what each rep gets this month (override or even share)
};

export async function getGoals(range: DateRange, members: Member[]): Promise<GoalSet> {
  const months = monthsIn(range);
  const rows = await db
    .select()
    .from(goals)
    .where(and(gte(goals.month, months[0].month), lte(goals.month, months[months.length - 1].month)));

  let team: number | null = null;
  const byRep = new Map<string, number>();
  let firstShares = new Map<string, number>();
  for (const [i, { month, fraction }] of months.entries()) {
    const monthRange = { startDate: `${month}-01`, endDate: `${month}-31` };
    const reps = activeReps(members, monthRange);
    const teamTarget = rows.find((r) => r.month === month && r.ownerId === "")?.target ?? null;
    const overrides = new Map(
      rows.filter((r) => r.month === month && r.ownerId !== "").map((r) => [r.ownerId, r.target]),
    );
    const shares = new Map<string, number>();
    if (teamTarget != null || overrides.size > 0) {
      const overridden = reps.filter((r) => overrides.has(r.hubspotOwnerId));
      const rest = reps.filter((r) => !overrides.has(r.hubspotOwnerId));
      const overrideSum = overridden.reduce((s, r) => s + overrides.get(r.hubspotOwnerId)!, 0);
      const remaining = Math.max(0, (teamTarget ?? overrideSum) - overrideSum);
      for (const r of overridden) shares.set(r.hubspotOwnerId, overrides.get(r.hubspotOwnerId)!);
      for (const r of rest) shares.set(r.hubspotOwnerId, rest.length ? remaining / rest.length : 0);
      const monthTeam = teamTarget ?? overrideSum;
      team = (team ?? 0) + monthTeam * fraction;
      for (const [id, v] of shares) byRep.set(id, (byRep.get(id) ?? 0) + v * fraction);
    }
    if (i === 0) firstShares = shares;
  }

  const first = months[0].month;
  return {
    team,
    byRep,
    monthTeam: rows.find((r) => r.month === first && r.ownerId === "")?.target ?? null,
    monthOverrides: new Map(rows.filter((r) => r.month === first && r.ownerId !== "").map((r) => [r.ownerId, r.target])),
    monthShares: firstShares,
  };
}

// Where the team "should" be today if it's on pace: the goal times the share
// of the period's days that have passed (whole period once it's over).
export function paceFraction(range: DateRange, today: string): number {
  if (today < range.startDate) return 0;
  if (today >= range.endDate) return 1;
  const d = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;
  return (d(range.startDate, today) + 1) / (d(range.startDate, range.endDate) + 1);
}
