"use client";

import { useTransition } from "react";
import { triggerSyncNow } from "@/app/(dashboard)/sync-actions";

export function SyncNowButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(() => triggerSyncNow())}
      className="rounded border px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50"
      style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}
    >
      {isPending ? "Syncing…" : "Sync now"}
    </button>
  );
}
