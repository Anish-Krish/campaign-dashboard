import Link from "next/link";
import { logout } from "@/app/logout/actions";

export function Nav() {
  return (
    <header
      style={{
        borderBottom: "1px solid rgba(14, 165, 183, 0.25)",
        background: "var(--background)",
        boxShadow: "0 1px 20px var(--glow-cyan-soft)",
      }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-6">
          <span className="hud-heading flex items-center gap-2 text-xs" style={{ color: "var(--series-blue)" }}>
            <span
              className="inline-block h-1.5 w-1.5 animate-[hud-pulse_2s_ease-in-out_infinite] rounded-full"
              style={{ background: "var(--series-blue)", boxShadow: "0 0 6px var(--series-blue)" }}
              aria-hidden
            />
            Online
          </span>
          <nav className="hud-heading flex items-center gap-6 text-xs" style={{ color: "var(--text-secondary)" }}>
            <Link href="/" className="transition hover:text-[var(--series-blue)]">
              Dashboard
            </Link>
            <Link href="/campaigns" className="transition hover:text-[var(--series-blue)]">
              Campaigns
            </Link>
            <Link href="/settings" className="transition hover:text-[var(--series-blue)]">
              Settings
            </Link>
          </nav>
        </div>
        <form action={logout}>
          <button type="submit" className="hud-button rounded px-3 py-1.5 text-xs">
            Log out
          </button>
        </form>
      </div>
    </header>
  );
}
