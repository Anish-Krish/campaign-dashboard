"use client";

import { useActionState } from "react";
import { changePassword } from "./actions";

const inputClass = "w-full rounded border bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500";
const inputStyle = { borderColor: "var(--border-hairline)", color: "var(--text-primary)" };

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, undefined);
  return (
    <form action={action} className="grid max-w-sm gap-3">
      <input name="current" type="password" placeholder="Current password" autoComplete="current-password" required className={inputClass} style={inputStyle} />
      <input name="next" type="password" placeholder="New password (8+ characters)" autoComplete="new-password" required className={inputClass} style={inputStyle} />
      {state?.error && <p className="text-sm" style={{ color: "var(--series-red)" }}>{state.error}</p>}
      {state?.message && <p className="text-sm" style={{ color: "var(--status-good)" }}>{state.message}</p>}
      <button type="submit" disabled={pending} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
