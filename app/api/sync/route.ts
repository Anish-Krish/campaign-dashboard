import { NextResponse } from "next/server";
import { runSyncJob } from "@/lib/sync";

export const maxDuration = 300; // seconds — Vercel Cron functions can run long; batch HubSpot calls take a while

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runSyncJob();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
