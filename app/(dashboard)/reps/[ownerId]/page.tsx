import { notFound } from "next/navigation";
import Link from "next/link";
import { StatTile, StatTileRow } from "@/components/StatTile";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { DailyCallsChart } from "@/components/DailyCallsChart";
import { resolveDateRange } from "@/lib/date-range";
import { getActiveReps, getRepDailyCallStats, getRepRangeStats } from "@/lib/queries";

export const dynamic = "force-dynamic";

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function RepDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ ownerId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { ownerId } = await params;
  const sp = await searchParams;
  const range = resolveDateRange({ range: str(sp.range), from: str(sp.from), to: str(sp.to) });

  const [reps, stats, dailyStats] = await Promise.all([
    getActiveReps(),
    getRepRangeStats(ownerId, range),
    getRepDailyCallStats(ownerId, range),
  ]);

  const rep = reps.find((r) => r.ownerId === ownerId);
  if (!rep) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Link href="/reps" className="text-sm hover:underline" style={{ color: "var(--series-blue)" }}>
          ← Reps
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{rep.ownerName}</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          {range.label}
        </p>
      </div>

      <DateRangeFilter current={range} />

      <StatTileRow>
        <StatTile label="Calls Made" value={stats.callsMade} />
        <StatTile label="Connects" value={stats.connects} />
        <StatTile label="Conversations" value={stats.conversations} />
        <StatTile label="Meetings Booked" value={stats.meetings} />
        <StatTile
          label="Connect → Meeting Rate"
          value={`${stats.connectToMeetingRate}%`}
          percent={stats.connectToMeetingRate}
        />
        <StatTile
          label="Conversation → Meeting Rate"
          value={`${stats.conversationToMeetingRate}%`}
          percent={stats.conversationToMeetingRate}
        />
      </StatTileRow>

      <div className="hud-panel">
        <h3 className="hud-heading px-5 pt-4 text-xs" style={{ color: "var(--text-secondary)" }}>
          Calls by day
        </h3>
        <DailyCallsChart data={dailyStats} mode="calls" />
      </div>
    </div>
  );
}
