"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, undefined);

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: "var(--background)" }}>
      <form action={formAction} className="hud-panel w-full max-w-sm p-8">
        <h1 className="hud-heading mb-1 text-sm" style={{ color: "var(--series-blue)" }}>
          Campaign Dashboard
        </h1>
        <p className="mb-6 text-xs" style={{ color: "var(--text-muted)" }}>
          Authorization required
        </p>
        <label className="hud-heading mb-1 block text-xs" style={{ color: "var(--text-secondary)" }} htmlFor="password">
          Team password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          className="mb-4 w-full rounded border bg-transparent px-3 py-2 outline-none"
          style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
        />
        {state?.error && (
          <p className="mb-4 text-sm" style={{ color: "var(--series-red)" }}>
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending} className="hud-button w-full rounded px-3 py-2 text-xs">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
