import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncRuns } from "@/lib/db/schema";
import { runSync } from "@/lib/sync";
import { eq } from "drizzle-orm";

export const maxDuration = 300; // seconds — Vercel Cron functions can run long; batch HubSpot calls take a while

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [run] = await db.insert(syncRuns).values({ status: "running" }).returning();

  try {
    const result = await runSync();
    const hasFailures = result.failed.length > 0;
    await db
      .update(syncRuns)
      .set({
        status: hasFailures ? "error" : "success",
        errorMessage: hasFailures
          ? result.failed.map((f) => `${f.name} (#${f.campaignId}): ${f.error}`).join("; ")
          : null,
        finishedAt: new Date(),
      })
      .where(eq(syncRuns.id, run.id));
    return NextResponse.json({ ok: !hasFailures, syncRunId: run.id, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(syncRuns)
      .set({ status: "error", errorMessage: message, finishedAt: new Date() })
      .where(eq(syncRuns.id, run.id));
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
