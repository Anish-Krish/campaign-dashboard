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
    await runSync();
    await db
      .update(syncRuns)
      .set({ status: "success", finishedAt: new Date() })
      .where(eq(syncRuns.id, run.id));
    return NextResponse.json({ ok: true, syncRunId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(syncRuns)
      .set({ status: "error", errorMessage: message, finishedAt: new Date() })
      .where(eq(syncRuns.id, run.id));
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
