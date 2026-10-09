"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { HubspotList } from "@/lib/hubspot";

type Member = { id: string; name: string };
type Campaign = { id: number; name: string };

// Searchable dropdown for HubSpot contact lists: type to filter by name, arrow
// keys + Enter to pick. Submits the chosen list ID through a hidden input.
function ListPicker({ lists, onPick }: { lists: HubspotList[]; onPick: (l: HubspotList) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<HubspotList | null>(null);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    return lists.filter((l) => words.every((w) => l.name.toLowerCase().includes(w))).slice(0, 50);
  }, [lists, query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const choose = (l: HubspotList) => {
    setPicked(l);
    setQuery("");
    setOpen(false);
    onPick(l);
  };

  return (
    <div ref={boxRef} className="relative">
      <input type="hidden" name="listId" value={picked?.listId ?? ""} required />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input flex items-center justify-between text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span style={{ color: picked ? "var(--text-primary)" : "var(--text-muted)" }} className="truncate">
          {picked ? picked.name : "Choose a HubSpot contact list…"}
        </span>
        <span style={{ color: "var(--text-muted)" }}>▾</span>
      </button>
      {open && (
        <div
          className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg"
          style={{ background: "var(--surface)", border: "1px solid var(--border-strong)", boxShadow: "0 12px 32px rgba(0,0,0,0.5)" }}
        >
          <div className="p-2" style={{ borderBottom: "1px solid var(--border-hairline)" }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, matches.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (matches[active]) choose(matches[active]);
                } else if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Search lists — e.g. “Hadi List 3”"
              className="input"
            />
          </div>
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {matches.length === 0 && (
              <li className="px-3 py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                No unregistered lists match.
              </li>
            )}
            {matches.map((l, i) => (
              <li
                key={l.listId}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(l);
                }}
                className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm"
                style={{ background: i === active ? "var(--surface-2)" : undefined }}
              >
                <span className="truncate" style={{ color: "var(--text-primary)" }}>
                  {l.name}
                </span>
                <span className="shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
                  {l.size != null ? `${l.size.toLocaleString()} contacts` : ""}
                  {l.createdAt ? ` · ${l.createdAt.slice(0, 10)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function RegisterSegmentForm({
  action,
  lists,
  campaigns,
  members,
  isAdmin,
}: {
  action: (formData: FormData) => Promise<void>;
  lists: HubspotList[];
  campaigns: Campaign[];
  members: Member[];
  isAdmin: boolean;
}) {
  const [ownerId, setOwnerId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [newCampaign, setNewCampaign] = useState(campaigns.length === 0);
  const [pending, setPending] = useState(false);

  // Pre-fill the rep from the list name ("… - Hadi (List 2)") and the start
  // date from when the list was created; both stay editable.
  const onPick = (l: HubspotList) => {
    const lower = l.name.toLowerCase();
    const m = members.find((mm) => lower.includes(mm.name.split(" ")[0].toLowerCase()));
    if (m) setOwnerId(m.id);
    if (l.createdAt) setStartDate(l.createdAt.slice(0, 10));
  };

  return (
    <form
      action={async (fd) => {
        setPending(true);
        try {
          await action(fd);
        } finally {
          setPending(false);
        }
      }}
      className="grid grid-cols-1 gap-4 md:grid-cols-6"
    >
      <label className="md:col-span-6">
        <span className="eyebrow mb-1.5 block">HubSpot list</span>
        <ListPicker lists={lists} onPick={onPick} />
      </label>
      <label className="md:col-span-3">
        <span className="eyebrow mb-1.5 flex items-center justify-between">
          Campaign
          {campaigns.length > 0 && (
            <button type="button" className="text-xs hover:underline" style={{ color: "var(--accent)" }} onClick={() => setNewCampaign((v) => !v)}>
              {newCampaign ? "Pick existing" : "+ New campaign"}
            </button>
          )}
        </span>
        {newCampaign ? (
          <input name="newCampaign" required placeholder="e.g. Manufacturing X3 Canada" className="input" />
        ) : (
          <select name="campaignId" defaultValue={campaigns[0]?.id} className="input">
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </label>
      {isAdmin ? (
        <label className="md:col-span-3">
          <span className="eyebrow mb-1.5 block">Rep</span>
          <select name="ownerId" required value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="input">
            <option value="" disabled>
              Choose…
            </option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="md:col-span-3" />
      )}
      <label className="md:col-span-2">
        <span className="eyebrow mb-1.5 block">Start date</span>
        <input name="startDate" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
      </label>
      <label className="md:col-span-2">
        <span className="eyebrow mb-1.5 block">
          End date <span style={{ color: "var(--text-muted)" }}>· optional</span>
        </span>
        <input name="endDate" type="date" className="input" />
      </label>
      <div className="flex items-end md:col-span-2">
        <button type="submit" disabled={pending} className="btn btn-primary w-full justify-center px-4 py-2">
          {pending ? "Registering…" : "Register segment"}
        </button>
      </div>
    </form>
  );
}
