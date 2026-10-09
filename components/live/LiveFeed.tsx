"use client";

import { useEffect, useState } from "react";
import { confetti, playFor, unlockAudio } from "./effects";
import { useLive, type FeedEvent } from "./LiveProvider";

const EMOJIS = ["🔥", "👏", "🎉", "💪", "😂", "❤️"];

const KIND: Record<string, { icon: string; tint: string; label: string }> = {
  meeting: { icon: "📅", tint: "rgba(85,152,231,0.14)", label: "Meeting booked" },
  bant: { icon: "🔥", tint: "rgba(34,165,91,0.16)", label: "BANT" },
  goal: { icon: "🎯", tint: "rgba(227,160,8,0.16)", label: "Goal hit" },
  chat: { icon: "💬", tint: "transparent", label: "" },
};

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function Item({ e, now }: { e: FeedEvent; now: number }) {
  const live = useLive()!;
  const [picker, setPicker] = useState(false);
  const mine = live.reactions.filter((r) => r.eventId === e.id);
  const grouped = EMOJIS.map((emoji) => ({
    emoji,
    n: mine.filter((r) => r.emoji === emoji).length,
    me: mine.some((r) => r.emoji === emoji && r.userId === live.me),
    names: mine.filter((r) => r.emoji === emoji).map((r) => r.name),
  })).filter((g) => g.n > 0);
  const k = KIND[e.kind] ?? KIND.chat;
  const win = e.kind !== "chat";

  return (
    <li className="group px-4 py-3" style={{ borderTop: "1px solid var(--gridline)" }}>
      <div className="flex gap-3">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-base"
          style={{ background: win ? k.tint : "var(--surface-2)" }}
          aria-hidden
        >
          {win ? k.icon : (e.author ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
              {win ? e.title : e.author}
            </span>
            <span className="shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>
              {ago(e.at, now)}
            </span>
          </div>
          <div className="mt-0.5 break-words text-[13px]" style={{ color: "var(--text-secondary)" }}>
            {win ? e.body : e.title}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {grouped.map((g) => (
              <button
                key={g.emoji}
                onClick={() => live.react(e.id, g.emoji)}
                title={g.names.join(", ")}
                className="rounded-full px-2 py-0.5 text-xs transition"
                style={{
                  background: g.me ? "var(--accent-soft)" : "var(--surface-2)",
                  border: `1px solid ${g.me ? "var(--accent)" : "transparent"}`,
                  color: "var(--text-primary)",
                }}
              >
                {g.emoji} {g.n}
              </button>
            ))}
            <span className="relative">
              <button
                onClick={() => setPicker((v) => !v)}
                className="rounded-full px-2 py-0.5 text-xs opacity-60 transition hover:opacity-100 group-hover:opacity-100"
                style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                aria-label="Add reaction"
              >
                ☺+
              </button>
              {picker && (
                <span
                  className="absolute bottom-full left-0 z-10 mb-1 flex gap-1 rounded-full px-2 py-1 shadow-xl"
                  style={{ background: "var(--surface)", border: "1px solid var(--border-strong)" }}
                >
                  {EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => {
                        setPicker(false);
                        void live.react(e.id, emoji);
                      }}
                      className="rounded-full px-1 text-base transition hover:scale-125"
                    >
                      {emoji}
                    </button>
                  ))}
                </span>
              )}
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}

// The team's live channel: every win as it happens, plus chat and reactions.
export function LiveFeed() {
  const live = useLive();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!live) return null;

  return (
    <section className="card flex max-h-[760px] min-h-[420px] flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border-hairline)" }}>
        <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          <span className="relative flex h-2.5 w-2.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: "var(--status-good)" }} />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: "var(--status-good)" }} />
          </span>
          Live
        </span>
        <span className="flex items-center gap-1.5">
          <button
            onClick={() => {
              unlockAudio();
              setTimeout(() => playFor("meeting"), 60);
              setTimeout(() => {
                playFor("bant");
                confetti();
              }, 1400);
            }}
            className="btn px-2 py-1 text-xs"
            title="Play the meeting sound, then the BANT celebration (only on your screen)"
          >
            ▶ Try
          </button>
          <button
            onClick={() => live.setSoundOn(!live.soundOn)}
            className="btn px-2.5 py-1 text-xs"
            title={live.soundOn ? "Sounds on — click to mute" : "Sounds off — click to turn on"}
          >
            {live.soundOn ? "🔊 Sound on" : "🔇 Muted"}
          </button>
        </span>
      </div>
      {live.soundOn && live.soundBlocked && (
        <div className="px-4 py-2 text-xs" style={{ background: "rgba(227,160,8,0.10)", color: "var(--status-warning)" }}>
          Click anywhere on the page once to let the browser play the win sounds.
        </div>
      )}

      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          if (!text.trim() || sending) return;
          setSending(true);
          try {
            await live.send(text);
            setText("");
          } finally {
            setSending(false);
          }
        }}
        className="flex gap-2 px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-hairline)" }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Hype the team…"
          maxLength={500}
          className="input py-1.5"
          aria-label="Message"
        />
        <button type="submit" disabled={sending || !text.trim()} className="btn btn-primary px-3 py-1.5">
          Send
        </button>
      </form>

      <ul className="flex-1 overflow-y-auto">
        {live.events.length === 0 && (
          <li className="px-4 py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            Bookings, BANTs and goal hits show up here the moment they happen.
          </li>
        )}
        {live.events.map((e) => (
          <Item key={e.id} e={e} now={now} />
        ))}
      </ul>
    </section>
  );
}
