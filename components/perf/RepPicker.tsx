"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export type RepOption = { id: string; name: string; href: string; current: boolean };

function Avatar({ name, size = 26 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.4, background: "var(--surface-2)", color: "var(--text-primary)" }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

// "Viewing: Team ▾" — switches the whole page between the team and one rep.
export function RepPicker({
  label,
  teamHref,
  reps,
  former,
}: {
  label: string | null; // selected rep's name, null = whole team
  teamHref: string;
  reps: RepOption[];
  former: RepOption[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = (o: { name: string; href: string; current: boolean }, avatar: React.ReactNode) => (
    <Link
      key={o.href}
      href={o.href}
      onClick={() => setOpen(false)}
      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition hover:bg-[var(--surface-2)]"
      style={{ color: o.current ? "var(--text-primary)" : "var(--text-secondary)" }}
      aria-current={o.current}
    >
      {avatar}
      <span className="flex-1 truncate">{o.name}</span>
      {o.current && <span style={{ color: "var(--accent)" }}>✓</span>}
    </Link>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-lg px-1 py-0.5 text-left transition hover:bg-[var(--surface-2)]"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {label ? (
          <Avatar name={label} size={34} />
        ) : (
          <span className="grid h-[34px] w-[34px] place-items-center rounded-full text-base" style={{ background: "var(--accent-soft)", color: "var(--accent)" }} aria-hidden>
            ◎
          </span>
        )}
        <span className="text-[22px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {label ?? "Team"}
        </span>
        <span className="mt-1 text-sm" style={{ color: "var(--text-muted)" }} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div
          className="absolute left-0 z-40 mt-2 w-64 rounded-xl p-1.5 shadow-2xl"
          style={{ background: "var(--surface)", border: "1px solid var(--border-strong)" }}
          role="listbox"
        >
          {item(
            { name: "Whole team", href: teamHref, current: label == null },
            <span className="grid h-[26px] w-[26px] place-items-center rounded-full text-xs" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
              ◎
            </span>,
          )}
          {reps.length > 0 && <div className="eyebrow px-2.5 pt-2.5 pb-1">Reps</div>}
          {reps.map((r) => item(r, <Avatar name={r.name} />))}
          {former.length > 0 && <div className="eyebrow px-2.5 pt-2.5 pb-1">Former</div>}
          {former.map((r) => item(r, <Avatar name={r.name} />))}
        </div>
      )}
    </div>
  );
}
