import { NextResponse } from "next/server";
import { desc, gt, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { liveEvents, liveReactions, users } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// Polled every few seconds by every open page: the latest feed items (wins +
// chat) with reactions. ?after=<id> returns only newer items plus the
// reactions on the recent window, so a poll is one cheap query when idle.
export async function GET(request: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const after = Number(new URL(request.url).searchParams.get("after") ?? 0) || 0;
  const rows = await db
    .select()
    .from(liveEvents)
    .where(after ? gt(liveEvents.id, after) : undefined)
    .orderBy(desc(liveEvents.id))
    .limit(after ? 50 : 40);

  // reactions for everything the client may be showing (last 40 + new)
  const recent = await db.select({ id: liveEvents.id }).from(liveEvents).orderBy(desc(liveEvents.id)).limit(60);
  const ids = recent.map((r) => r.id);
  const reactions = ids.length
    ? await db.select().from(liveReactions).where(inArray(liveReactions.eventId, ids))
    : [];
  const people = await db.select({ id: users.id, name: users.name }).from(users);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  return NextResponse.json({
    me: me.id,
    events: rows.map((e) => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      body: e.body,
      ownerId: e.ownerId,
      author: e.userId ? (nameOf.get(e.userId) ?? "Someone") : null,
      userId: e.userId,
      at: e.createdAt.toISOString(),
    })),
    reactions: reactions.map((r) => ({ eventId: r.eventId, emoji: r.emoji, userId: r.userId, name: nameOf.get(r.userId) ?? "" })),
  });
}
