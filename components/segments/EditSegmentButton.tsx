"use client";

import { useEffect, useState } from "react";

type Seg = { id: number; listName: string; campaignId: number; ownerId: string; startDate: string; endDate: string | null };

// Edit a segment in a side panel instead of expanding rows inline.
export function EditSegmentButton({
  seg,
  campaigns,
  members,
  isAdmin,
  updateAction,
  deleteAction,
}: {
  seg: Seg;
  campaigns: { id: number; name: string; archived: boolean }[];
  members: { id: string; name: string }[];
  isAdmin: boolean;
  updateAction: (fd: FormData) => Promise<void>;
  deleteAction: (fd: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn px-2.5 py-1">
        Edit
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Edit segment">
          <button className="absolute inset-0 cursor-default" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setOpen(false)} aria-label="Close" />
          <aside
            className="relative flex h-full w-full max-w-md flex-col"
            style={{ background: "var(--surface)", borderLeft: "1px solid var(--border-hairline)", animation: "drawer-in 160ms ease-out" }}
          >
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border-hairline)" }}>
              <h2 className="truncate text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                {seg.listName}
              </h2>
              <button onClick={() => setOpen(false)} className="btn px-2 py-1" aria-label="Close">
                ✕
              </button>
            </div>
            <form
              action={async (fd) => {
                await updateAction(fd);
                setOpen(false);
              }}
              className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
            >
              <input type="hidden" name="id" value={seg.id} />
              <label>
                <span className="eyebrow mb-1.5 block">Campaign</span>
                <select name="campaignId" defaultValue={seg.campaignId} className="input">
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.archived ? " (archived)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {isAdmin && (
                <label>
                  <span className="eyebrow mb-1.5 block">Rep</span>
                  <select name="ownerId" defaultValue={seg.ownerId} className="input">
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="eyebrow mb-1.5 block">Start date</span>
                  <input name="startDate" type="date" required defaultValue={seg.startDate} className="input" />
                </label>
                <label>
                  <span className="eyebrow mb-1.5 block">End date</span>
                  <input name="endDate" type="date" defaultValue={seg.endDate ?? ""} className="input" />
                </label>
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Only the rep&apos;s calls and deals inside these dates count toward this segment. Leave the end date blank while
                it&apos;s still running.
              </p>
              <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                <button
                  type="submit"
                  formAction={async (fd) => {
                    if (!confirm("Remove this segment? Its numbers will no longer be tracked.")) return;
                    await deleteAction(fd);
                    setOpen(false);
                  }}
                  className="btn px-3 py-2"
                  style={{ color: "var(--status-critical)" }}
                >
                  Remove segment
                </button>
                <button type="submit" className="btn btn-primary px-4 py-2">
                  Save changes
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
