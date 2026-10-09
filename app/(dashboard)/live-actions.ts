"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { liveEvents, liveReactions } from "@/lib/db/schema";
import { requireUser } from "@/lib/session";

const EMOJIS = new Set(["🔥", "👏", "🎉", "💪", "😂", "❤️"]);

// Team chat in the live feed — any login can post.
export async function postChat(text: string): Promise<{ ok: boolean }> {
  const me = await requireUser();
  const clean = text.trim().slice(0, 500);
  if (!clean) return { ok: false };
  await db.insert(liveEvents).values({ kind: "chat", title: clean, userId: me.id });
  return { ok: true };
}

// Toggle one emoji reaction on a feed item.
export async function toggleReaction(eventId: number, emoji: string): Promise<{ ok: boolean }> {
  const me = await requireUser();
  if (!EMOJIS.has(emoji) || !Number.isInteger(eventId)) return { ok: false };
  const where = and(eq(liveReactions.eventId, eventId), eq(liveReactions.userId, me.id), eq(liveReactions.emoji, emoji));
  const [existing] = await db.select().from(liveReactions).where(where);
  if (existing) await db.delete(liveReactions).where(where);
  else await db.insert(liveReactions).values({ eventId, userId: me.id, emoji }).onConflictDoNothing();
  return { ok: true };
}
