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
      className="hud-button rounded px-3 py-1.5 text-xs"
    >
      {isPending ? "Syncing…" : "Sync now"}
    </button>
  );
}
