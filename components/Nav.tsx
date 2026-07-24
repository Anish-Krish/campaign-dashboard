import Link from "next/link";
import { logout } from "@/app/logout/actions";

export function Nav() {
  return (
    <header className="border-b border-neutral-800 bg-neutral-950">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <nav className="flex items-center gap-6 text-sm font-medium text-neutral-300">
          <Link href="/" className="hover:text-white">
            Dashboard
          </Link>
          <Link href="/campaigns" className="hover:text-white">
            Campaigns
          </Link>
          <Link href="/settings" className="hover:text-white">
            Settings
          </Link>
        </nav>
        <form action={logout}>
          <button
            type="submit"
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            Log out
          </button>
        </form>
      </div>
    </header>
  );
}
