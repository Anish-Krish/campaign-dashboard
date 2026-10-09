"use server";

import { and, desc, eq, gte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { goals, syncRuns } from "@/lib/db/schema";
import { requireAdmin, requireUser } from "@/lib/session";
import { runSegmentSync } from "@/lib/segment-sync";
import { runTeamSync } from "@/lib/team-sync";
import { publishWins } from "@/lib/live";

// "Refresh" on the Performance page: pulls just the team data (calls, deals,
// meeting outcomes, segments) — ~40s, vs. the full scheduled job. Any login
// can run it. If a sync is already running (scheduled or someone else's
// click), it waits that one out instead of starting a second.
export async function refreshTeamData(): Promise<{ ok: boolean; error?: string }> {
  await requireUser();

  const [running] = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.status, "running"), gte(syncRuns.startedAt, new Date(Date.now() - 5 * 60_000))))
    .orderBy(desc(syncRuns.id))
    .limit(1);
  if (running) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const [r] = await db.select({ status: syncRuns.status }).from(syncRuns).where(eq(syncRuns.id, running.id));
      if (r?.status !== "running") break;
    }
    revalidatePath("/team");
    return { ok: true };
  }

  const [run] = await db.insert(syncRuns).values({ status: "running" }).returning();
  try {
    await runTeamSync();
    await runSegmentSync();
    await publishWins();
    await db.update(syncRuns).set({ status: "success", finishedAt: new Date() }).where(eq(syncRuns.id, run.id));
    revalidatePath("/team");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(syncRuns)
      .set({ status: "error", errorMessage: `Refresh: ${message}`, finishedAt: new Date() })
      .where(eq(syncRuns.id, run.id));
    return { ok: false, error: message };
  }
}

// Admin: a month's team BANT goal plus optional per-rep overrides. A blank
// rep field means "even share of what's left" (the override row is removed).
export async function saveGoals(fd: FormData): Promise<void> {
  await requireAdmin();
  const month = String(fd.get("month") ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("bad month");
  const toTarget = (v: FormDataEntryValue | null) => {
    const s = String(v ?? "").trim();
    if (s === "") return null;
    const n = Math.round(Number(s));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const entries: { ownerId: string; target: number | null }[] = [{ ownerId: "", target: toTarget(fd.get("team")) }];
  for (const [key, value] of fd.entries()) {
    if (key.startsWith("rep:")) entries.push({ ownerId: key.slice(4), target: toTarget(value) });
  }

  await db.transaction(async (tx) => {
    for (const e of entries) {
      if (e.target == null) {
        await tx.delete(goals).where(and(eq(goals.month, month), eq(goals.ownerId, e.ownerId)));
      } else {
        await tx
          .insert(goals)
          .values({ month, ownerId: e.ownerId, target: e.target })
          .onConflictDoUpdate({ target: [goals.month, goals.ownerId], set: { target: e.target, updatedAt: new Date() } });
      }
    }
  });
  revalidatePath("/team");
}
