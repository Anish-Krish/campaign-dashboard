import Link from "next/link";
import { getActiveReps } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function RepsPage() {
  const reps = await getActiveReps();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Reps</h1>
      <div className="hud-panel divide-y" style={{ borderColor: "var(--gridline)" }}>
        {reps.length === 0 && (
          <p className="px-5 py-6 text-sm" style={{ color: "var(--text-muted)" }}>
            No rep activity synced yet.
          </p>
        )}
        {reps.map((r) => (
          <Link
            key={r.ownerId}
            href={`/reps/${r.ownerId}`}
            className="flex items-center justify-between px-5 py-4 text-sm transition hover:bg-white/5"
            style={{ borderColor: "var(--gridline)" }}
          >
            <span style={{ color: "var(--text-primary)" }}>{r.ownerName}</span>
            <span style={{ color: "var(--series-blue)" }}>View →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
