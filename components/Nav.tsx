import Link from "next/link";
import { logout } from "@/app/logout/actions";
import { getCurrentUser } from "@/lib/session";

// Role-aware: BDR logins see Team + Segments + their account; admins also see
// the archived legacy views, Enrichment and Settings (proxy.ts enforces it).
export async function Nav() {
  const user = await getCurrentUser();
  const isAdmin = user?.role === "admin";
  const links = [
    { href: "/team", label: "Team" },
    { href: "/segments", label: "Segments" },
    ...(isAdmin
      ? [
          { href: "/archive", label: "Archive" },
          { href: "/enrichment", label: "Enrichment" },
          { href: "/settings", label: "Settings" },
        ]
      : []),
  ];

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
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="transition hover:text-[var(--series-blue)]">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {user && (
            <Link href="/account" className="text-xs transition hover:text-[var(--series-blue)]" style={{ color: "var(--text-muted)" }}>
              {user.name}
            </Link>
          )}
          <form action={logout}>
            <button type="submit" className="hud-button rounded px-3 py-1.5 text-xs">
              Log out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
