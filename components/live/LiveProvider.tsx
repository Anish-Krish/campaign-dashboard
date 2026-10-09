"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postChat, toggleReaction } from "@/app/(dashboard)/live-actions";
import { audioReady, confetti, playFor, unlockAudio } from "./effects";

export type FeedEvent = {
  id: number;
  kind: "meeting" | "bant" | "goal" | "chat";
  title: string;
  body: string | null;
  ownerId: string | null;
  author: string | null;
  userId: number | null;
  at: string;
};
export type FeedReaction = { eventId: number; emoji: string; userId: number; name: string };

type Ctx = {
  events: FeedEvent[];
  reactions: FeedReaction[];
  me: number | null;
  soundOn: boolean;
  soundBlocked: boolean;
  setSoundOn: (v: boolean) => void;
  send: (text: string) => Promise<void>;
  react: (eventId: number, emoji: string) => Promise<void>;
};

const LiveCtx = createContext<Ctx | null>(null);
export const useLive = () => useContext(LiveCtx);

const POLL_MS = 5000;
const WIN_KINDS = new Set(["meeting", "bant", "goal"]);

type Toast = { key: number; e: FeedEvent };

// Polls the live feed on every page: new wins play their sound, pop a toast
// (BANT / goal: full-width banner + confetti) and refresh the numbers.
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [reactions, setReactions] = useState<FeedReaction[]>([]);
  const [me, setMe] = useState<number | null>(null);
  const [soundOn, setSoundOnState] = useState(true);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [banner, setBanner] = useState<FeedEvent | null>(null);
  const lastId = useRef(0);
  const primed = useRef(false);
  const soundRef = useRef(true);

  useEffect(() => {
    try {
      const v = localStorage.getItem("live-sound");
      if (v === "off") {
        setSoundOnState(false);
        soundRef.current = false;
      }
    } catch {}
    const unlock = () => {
      unlockAudio();
      setTimeout(() => setSoundBlocked(!audioReady()), 50);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    setSoundBlocked(!audioReady());
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const setSoundOn = useCallback((v: boolean) => {
    setSoundOnState(v);
    soundRef.current = v;
    try {
      localStorage.setItem("live-sound", v ? "on" : "off");
    } catch {}
    if (v) unlockAudio();
  }, []);

  const celebrate = useCallback(
    (e: FeedEvent, mine: boolean) => {
      if (soundRef.current && !(e.kind === "chat" && mine)) playFor(e.kind);
      if (e.kind === "chat") {
        if (!mine) setToasts((t) => [...t, { key: e.id, e }]);
        return;
      }
      if (e.kind === "bant" || e.kind === "goal") {
        confetti(e.kind === "goal" ? 1.6 : 1);
        setBanner(e);
        setTimeout(() => setBanner((b) => (b?.id === e.id ? null : b)), 6000);
      } else {
        setToasts((t) => [...t, { key: e.id, e }]);
      }
    },
    [],
  );

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/live/feed?after=${lastId.current}`, { cache: "no-store" });
      if (!res.ok || !res.headers.get("content-type")?.includes("json")) return;
      const data: { me: number; events: FeedEvent[]; reactions: FeedReaction[] } = await res.json();
      setMe(data.me);
      setReactions(data.reactions);
      if (data.events.length === 0) return;
      const fresh = [...data.events].sort((a, b) => a.id - b.id);
      lastId.current = Math.max(lastId.current, fresh[fresh.length - 1].id);
      setEvents((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...fresh.filter((f) => !seen.has(f.id)).reverse(), ...prev].slice(0, 80);
      });
      // the first load is history — only celebrate what arrives after it
      if (primed.current) {
        for (const e of fresh) celebrate(e, e.userId != null && e.userId === data.me);
        if (fresh.some((e) => WIN_KINDS.has(e.kind))) router.refresh();
      }
      primed.current = true;
    } catch {}
  }, [celebrate, router]);

  useEffect(() => {
    void poll();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  // toasts fade after 7s
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => setToasts((ts) => ts.slice(1)), 7000);
    return () => clearTimeout(t);
  }, [toasts]);

  const send = useCallback(
    async (text: string) => {
      await postChat(text);
      await poll();
    },
    [poll],
  );
  const react = useCallback(
    async (eventId: number, emoji: string) => {
      await toggleReaction(eventId, emoji);
      await poll();
    },
    [poll],
  );

  return (
    <LiveCtx.Provider value={{ events, reactions, me, soundOn, soundBlocked, setSoundOn, send, react }}>
      {children}

      {banner && (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-[90] flex justify-center px-4" role="status" aria-live="polite">
          <div
            className="pointer-events-auto rounded-2xl px-7 py-5 text-center shadow-2xl"
            style={{
              background: "linear-gradient(135deg, rgba(34,165,91,0.95), rgba(28,92,171,0.95))",
              border: "1px solid rgba(255,255,255,0.25)",
              animation: "banner-in 420ms cubic-bezier(.2,1.4,.4,1)",
            }}
          >
            <div className="text-3xl font-bold text-white">
              {banner.kind === "goal" ? "🎯 " : "🔥 "}
              {banner.title}
            </div>
            {banner.body && <div className="mt-1 text-base text-white/85">{banner.body}</div>}
          </div>
        </div>
      )}

      <div className="pointer-events-none fixed bottom-5 right-5 z-[80] flex w-80 flex-col gap-2" aria-live="polite">
        {toasts.map(({ key, e }) => (
          <div
            key={key}
            className="pointer-events-auto rounded-xl px-4 py-3 shadow-xl"
            style={{ background: "var(--surface)", border: "1px solid var(--border-strong)", animation: "drawer-in 200ms ease-out" }}
          >
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {e.kind === "chat" ? `💬 ${e.author}` : `📅 ${e.title}`}
            </div>
            <div className="mt-0.5 truncate text-xs" style={{ color: "var(--text-secondary)" }}>
              {e.kind === "chat" ? e.title : e.body}
            </div>
          </div>
        ))}
      </div>
    </LiveCtx.Provider>
  );
}
