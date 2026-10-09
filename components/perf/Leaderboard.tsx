import Link from "next/link";

// ---------------------------------------------------------------------------
// Goal progress (team or one rep) — the hero at the top of the page
// ---------------------------------------------------------------------------

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-US");

export function GoalProgress({
  eyebrow,
  actual,
  target,
  pace,
  daysLeft,
  editor,
  stats,
}: {
  eyebrow: string;
  actual: number;
  target: number | null;
  pace: number; // 0..1 share of the period elapsed
  daysLeft: number | null;
  editor?: React.ReactNode;
  stats: { label: string; value: string }[];
}) {
  const pct = target ? Math.min(100, (actual / target) * 100) : 0;
  const expected = target ? target * pace : 0;
  const hit = target != null && target > 0 && actual >= target;
  const behind = target != null && !hit ? Math.ceil(expected - actual - 1e-9) : 0;
  const status = target == null
    ? null
    : hit
      ? { text: "Goal hit", color: "var(--status-good)" }
      : behind <= 0
        ? { text: "On pace", color: "var(--status-good)" }
        : { text: `${behind} behind pace`, color: "var(--status-warning)" };

  return (
    <section
      className="card relative overflow-hidden p-6"
      style={hit ? { borderColor: "rgba(34,165,91,0.45)" } : undefined}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: hit
            ? "radial-gradient(120% 140% at 0% 0%, rgba(34,165,91,0.14), transparent 55%)"
            : "radial-gradient(120% 140% at 0% 0%, rgba(85,152,231,0.12), transparent 55%)",
        }}
        aria-hidden
      />
      <div className="relative flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-[260px] flex-1">
          <div className="flex items-center gap-3">
            <span className="eyebrow">{eyebrow}</span>
            {status && (
              <span className="pill" style={{ ["--dot" as string]: status.color }}>
                {status.text}
              </span>
            )}
          </div>
          {target == null ? (
            <div className="mt-3 flex items-baseline gap-3">
              <span className="text-[44px] font-semibold leading-none" style={{ color: "var(--text-primary)" }}>
                {actual}
              </span>
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                BANT meetings · no goal set for this period
              </span>
            </div>
          ) : (
            <>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-[44px] font-semibold leading-none" style={{ color: "var(--text-primary)" }}>
                  {actual}
                </span>
                <span className="text-2xl font-medium" style={{ color: "var(--text-muted)" }}>
                  / {fmt1(target)}
                </span>
                <span className="ml-1 text-sm" style={{ color: "var(--text-muted)" }}>
                  BANT meetings
                </span>
              </div>
              <div className="relative mt-5 h-3 rounded-full" style={{ background: "var(--surface-2)" }}>
                <div
                  className="h-3 rounded-full transition-[width] duration-700"
                  style={{
                    width: `${pct > 0 ? Math.max(2, pct) : 0}%`,
                    background: hit ? "var(--status-good)" : "linear-gradient(90deg, var(--ramp-3), var(--accent))",
                  }}
                />
                {pace > 0 && pace < 1 && (
                  <div
                    className="absolute -top-1.5 -bottom-1.5 w-0.5 rounded-full"
                    style={{ left: `${pace * 100}%`, background: "var(--text-secondary)" }}
                    title={`Pace: ${fmt1(expected)} by today`}
                  />
                )}
              </div>
              <div className="mt-2 flex justify-between text-xs" style={{ color: "var(--text-muted)" }}>
                <span>
                  {Math.round(pct)}% of goal
                  {!hit && ` · ${fmt1(Math.max(0, target - actual))} to go`}
                </span>
                <span>
                  {pace > 0 && pace < 1 ? `pace ${fmt1(expected)} by today` : ""}
                  {daysLeft != null && daysLeft > 0 ? ` · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : ""}
                </span>
              </div>
            </>
          )}
        </div>
        <div className="flex flex-col items-end gap-4">
          {editor}
          <div className="grid grid-cols-3 gap-x-6 gap-y-3 sm:grid-cols-5">
            {stats.map((s) => (
              <div key={s.label} className="text-right">
                <div className="eyebrow">{s.label}</div>
                <div className="mt-0.5 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export type LeaderRow = {
  ownerId: string;
  name: string;
  href: string;
  bant: number;
  goal: number | null;
  meetingsSet: number;
  sat: number;
  showRate: number | null;
  mqls: number;
  sqls: number;
  dials: number;
  conversations: number;
  // null = commission not shown (hidden by the admin, or not a month view)
  commission: { total: number; atHigh: boolean; toNextTier: number } | null;
};

function Avatar({ name, leader }: { name: string; leader: boolean }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold"
      style={{
        background: leader ? "rgba(34,165,91,0.18)" : "var(--surface-2)",
        color: leader ? "#5fd08f" : "var(--text-primary)",
        boxShadow: leader ? "0 0 0 2px var(--status-good)" : "none",
      }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

function Mini({ label, value, title, accent }: { label: string; value: string; title?: string; accent?: boolean }) {
  return (
    <div className="text-right" title={title}>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="text-[15px] font-semibold tabular-nums" style={{ color: accent ? "#5fd08f" : "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );
}

export function Leaderboard({
  rows,
  periodLabel,
  commissionNote,
}: {
  rows: LeaderRow[];
  periodLabel: string;
  commissionNote?: string | null;
}) {
  // BANT meetings set decides the order (that's commission); ties go to more
  // meetings set, then more sat.
  const ranked = [...rows].sort(
    (a, b) => b.bant - a.bant || b.meetingsSet - a.meetingsSet || b.sat - a.sat || a.name.localeCompare(b.name),
  );
  const topBant = ranked[0]?.bant ?? 0;

  return (
    <section className="card overflow-hidden">
      <div className="flex items-baseline justify-between px-6 pt-5 pb-3">
        <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          Leaderboard
        </h2>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {periodLabel} · ranked by BANT meetings set · click a rep for their full view
          {commissionNote ? ` · ${commissionNote}` : ""}
        </span>
      </div>
      {ranked.length === 0 && (
        <p className="px-6 pb-10 pt-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          No active reps in this period.
        </p>
      )}
      <ol>
        {ranked.map((r, i) => {
          const leader = i === 0 && topBant > 0 && (ranked[1]?.bant ?? -1) < topBant;
          const pct = r.goal ? Math.min(100, (r.bant / r.goal) * 100) : 0;
          const hit = r.goal != null && r.goal > 0 && r.bant >= r.goal;
          return (
            <li key={r.ownerId} style={{ borderTop: "1px solid var(--gridline)" }}>
              <Link
                href={r.href}
                className="group relative grid grid-cols-[36px_1fr_auto] items-center gap-4 px-6 py-4 transition hover:bg-[var(--surface-2)] md:grid-cols-[36px_minmax(160px,1fr)_minmax(220px,1.3fr)_auto]"
                style={leader ? { background: "linear-gradient(90deg, rgba(34,165,91,0.10), transparent 60%)" } : undefined}
              >
                {leader && (
                  <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: "var(--status-good)" }} aria-hidden />
                )}
                <span
                  className="grid h-8 w-8 place-items-center rounded-full text-sm font-bold tabular-nums"
                  style={
                    leader
                      ? { background: "var(--status-good)", color: "#06140c" }
                      : { background: "var(--surface-2)", color: "var(--text-secondary)" }
                  }
                >
                  {i + 1}
                </span>

                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={r.name} leader={leader} />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold group-hover:underline" style={{ color: "var(--text-primary)" }}>
                      {r.name}
                    </span>
                    <span className="block text-xs" style={{ color: leader ? "#5fd08f" : "var(--text-muted)" }}>
                      {leader ? "Leading" : `${r.dials.toLocaleString("en-US")} dials · ${r.conversations} convos`}
                    </span>
                  </span>
                </span>

                {/* BANT + goal progress */}
                <span className="col-span-3 flex items-center gap-4 md:col-span-1">
                  <span className="w-[72px] text-right">
                    <span className="text-[28px] font-bold leading-none tabular-nums" style={{ color: leader ? "#5fd08f" : "var(--text-primary)" }}>
                      {r.bant}
                    </span>
                    <span className="block text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                      BANT
                    </span>
                  </span>
                  <span className="flex-1">
                    {r.goal != null ? (
                      <>
                        <span className="block h-2 rounded-full" style={{ background: "var(--surface-2)" }}>
                          <span
                            className="block h-2 rounded-full"
                            style={{
                              width: `${pct > 0 ? Math.max(3, pct) : 0}%`,
                              background: hit || leader ? "var(--status-good)" : "var(--accent)",
                            }}
                          />
                        </span>
                        <span className="mt-1 block text-xs" style={{ color: "var(--text-muted)" }}>
                          {hit ? "Goal hit · " : ""}
                          {r.bant} of {fmt1(r.goal)} goal
                        </span>
                      </>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        No goal set
                      </span>
                    )}
                  </span>
                </span>

                <span className={`col-span-3 grid gap-4 md:col-span-1 ${r.commission ? "grid-cols-6" : "grid-cols-5"}`}>
                  <Mini label="Set" value={String(r.meetingsSet)} />
                  <Mini label="Sat" value={String(r.sat)} />
                  <Mini label="Show" value={r.showRate == null ? "—" : `${r.showRate}%`} />
                  <Mini label="MQL" value={String(r.mqls)} />
                  <Mini label="SQL" value={String(r.sqls)} />
                  {r.commission && (
                    <Mini
                      label="Earned"
                      value={`$${r.commission.total.toLocaleString("en-US")}`}
                      accent={r.commission.total > 0}
                      title={
                        r.commission.atHigh
                          ? "On the higher rate"
                          : `${r.commission.toNextTier} more BANT meeting${r.commission.toNextTier === 1 ? "" : "s"} to the higher rate`
                      }
                    />
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
