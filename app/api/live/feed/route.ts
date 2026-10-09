import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Feed = {
  events: { id: number; kind: string; title: string; body: string | null; ownerId: string | null; author: string | null; userId: number | null; at: string }[];
  reactions: { eventId: number; emoji: string; userId: number; name: string }[];
};

// Polled every few seconds by every open page: the latest feed items (wins +
// chat) and the reactions on the recent window. ?after=<id> returns only
// newer items. One query per poll — connections are scarce (session pooler).
export async function GET(request: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const after = Math.max(0, Number(new URL(request.url).searchParams.get("after") ?? 0) || 0);
  const [row] = await db.execute<{ data: Feed }>(sql`
    with ev as (
      select * from live_events where id > ${after} order by id desc limit ${after ? 50 : 40}
    ),
    win as (
      select id from live_events order by id desc limit 60
    )
    select json_build_object(
      'events', (
        select coalesce(json_agg(json_build_object(
          'id', ev.id, 'kind', ev.kind, 'title', ev.title, 'body', ev.body, 'ownerId', ev.owner_id,
          'author', case when ev.user_id is null then null else coalesce(u.name, 'Someone') end,
          'userId', ev.user_id,
          'at', to_char(ev.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        ) order by ev.id desc), '[]'::json)
        from ev left join users u on u.id = ev.user_id
      ),
      'reactions', (
        select coalesce(json_agg(json_build_object(
          'eventId', r.event_id, 'emoji', r.emoji, 'userId', r.user_id, 'name', coalesce(u.name, '')
        )), '[]'::json)
        from live_reactions r left join users u on u.id = r.user_id
        where r.event_id in (select id from win)
      )
    ) as data
  `);
  return NextResponse.json({ me: me.id, ...row.data });
}
