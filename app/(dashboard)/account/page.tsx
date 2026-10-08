import { requireUser } from "@/lib/session";
import { PasswordForm } from "./PasswordForm";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">My account</h1>
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        {user.name} · <span style={{ color: "var(--text-muted)" }}>{user.username}</span> · {user.role === "admin" ? "Admin" : "BDR"}
      </p>
      <PasswordForm />
    </div>
  );
}
