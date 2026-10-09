import Link from "next/link";
import { logout } from "@/app/logout/actions";
import { getCurrentUser } from "@/lib/session";
import { NavLinks } from "@/components/NavLinks";
import { LogoMark } from "@/components/LogoMark";

// Role-aware: BDR logins see Team + Segments + their account; admins also see
// the archived legacy views, Enrichment and Settings (proxy.ts enforces it).
export async function Nav() {
  const user = await getCurrentUser();
  const isAdmin = user?.role === "admin";
  const links = [
    { href: "/team", label: "Performance" },
    { href: "/segments", label: "Segments" },
    ...(isAdmin
      ? [
          { href: "/enrichment", label: "Enrichment" },
          { href: "/archive", label: "Archive" },
          { href: "/settings", label: "Settings" },
        ]
      : []),
  ];

  return (
    <header
      className="sticky top-0 z-30 backdrop-blur"
      style={{ borderBottom: "1px solid var(--border-hairline)", background: "rgba(11, 12, 14, 0.85)" }}
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link href="/team" className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            <LogoMark size={26} />
            <span>
              <span style={{ color: "#2f9be0" }}>IWI</span> Sales Performance
            </span>
          </Link>
          <NavLinks links={links} />
        </div>
        <div className="flex items-center gap-3">
          {user && (
            <Link
              href="/account"
              className="flex items-center gap-2 rounded-md px-2 py-1 text-sm transition hover:bg-[var(--surface-2)]"
              style={{ color: "var(--text-secondary)" }}
            >
              <span
                className="grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold"
                style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
                aria-hidden
              >
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              {user.name}
            </Link>
          )}
          <form action={logout}>
            <button type="submit" className="btn px-3 py-1.5">
              Log out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
