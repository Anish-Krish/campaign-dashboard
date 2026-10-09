"use client";

import { useEffect, useState } from "react";

// Admin: set the month's team BANT goal and optional per-rep overrides.
export function GoalEditor({
  month,
  monthLabel,
  team,
  reps,
  action,
}: {
  month: string;
  monthLabel: string;
  team: number | null;
  reps: { id: string; name: string; override: number | null; share: number | null }[];
  action: (fd: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [teamValue, setTeamValue] = useState(team == null ? "" : String(team));
  const [overrides, setOverrides] = useState<Record<string, string>>(() =>
    Object.fromEntries(reps.map((r) => [r.id, r.override == null ? "" : String(r.override)])),
  );
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // live preview of the even split, mirroring lib/goals.ts
  const teamN = teamValue === "" ? null : Number(teamValue);
  const set = reps.filter((r) => overrides[r.id] !== "");
  const setSum = set.reduce((s, r) => s + Number(overrides[r.id]), 0);
  const rest = reps.length - set.length;
  const evenShare = rest > 0 ? Math.max(0, (teamN ?? setSum) - setSum) / rest : 0;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn px-3 py-1.5">
        {team == null ? "Set goal" : "Edit goal"}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Goals">
          <button className="absolute inset-0 cursor-default" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setOpen(false)} aria-label="Close" />
          <aside
            className="relative flex h-full w-full max-w-md flex-col"
            style={{ background: "var(--surface)", borderLeft: "1px solid var(--border-hairline)", animation: "drawer-in 160ms ease-out" }}
          >
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border-hairline)" }}>
              <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                BANT goal · {monthLabel}
              </h2>
              <button onClick={() => setOpen(false)} className="btn px-2 py-1" aria-label="Close">
                ✕
              </button>
            </div>
            <form
              action={async (fd) => {
                await action(fd);
                setOpen(false);
              }}
              className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5"
            >
              <input type="hidden" name="month" value={month} />
              <label>
                <span className="eyebrow mb-1.5 block">Team goal (BANT meetings set)</span>
                <input
                  name="team"
                  type="number"
                  min={0}
                  value={teamValue}
                  onChange={(e) => setTeamValue(e.target.value)}
                  className="input text-lg"
                  placeholder="e.g. 12"
                  autoFocus
                />
              </label>
              <div>
                <div className="eyebrow mb-2">Per rep</div>
                <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
                  Leave blank for an even share of the team goal. Set a number to override one rep (e.g. someone ramping) —
                  the rest is split across the others.
                </p>
                <div className="space-y-2">
                  {reps.map((r) => (
                    <label key={r.id} className="flex items-center gap-3">
                      <span className="flex-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                        {r.name}
                      </span>
                      <input
                        name={`rep:${r.id}`}
                        type="number"
                        min={0}
                        value={overrides[r.id]}
                        onChange={(e) => setOverrides((o) => ({ ...o, [r.id]: e.target.value }))}
                        className="input w-28 text-right"
                        placeholder={`auto · ${Math.round(evenShare * 10) / 10}`}
                      />
                    </label>
                  ))}
                </div>
              </div>
              <div className="mt-auto flex justify-end pt-4">
                <button type="submit" className="btn btn-primary px-4 py-2">
                  Save goal
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
