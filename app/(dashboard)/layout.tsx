import { Nav } from "@/components/Nav";
import { LiveProvider } from "@/components/live/LiveProvider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <LiveProvider>
      <Nav />
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>
    </LiveProvider>
  );
}
