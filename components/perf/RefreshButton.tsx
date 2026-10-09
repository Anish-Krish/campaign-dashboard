"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshTeamData } from "@/app/(dashboard)/team/actions";

function ago(iso: string | null, now: number) {
  if (!iso) return "never";
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

export function RefreshButton({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
      <span title={lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : undefined}>
        {error ? <span style={{ color: "var(--status-critical)" }}>Refresh failed</span> : `Updated ${ago(lastSyncedAt, now)}`}
      </span>
      <button
        type="button"
        disabled={pending}
        className="btn px-2.5 py-1.5"
        title="Pull the latest calls, deals and meeting outcomes from HubSpot (about a minute)"
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await refreshTeamData();
            if (!res.ok) setError(res.error ?? "error");
            router.refresh();
          })
        }
      >
        <span className={pending ? "inline-block animate-spin" : "inline-block"} aria-hidden>
          ↻
        </span>{" "}
        {pending ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
