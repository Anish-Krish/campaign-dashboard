"use client";

import { useActionState } from "react";
import { login } from "./actions";
import { LogoMark } from "@/components/LogoMark";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, undefined);

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: "var(--background)" }}>
      <form action={formAction} className="hud-panel w-full max-w-sm p-8">
        <div className="mb-4">
          <LogoMark size={36} />
        </div>
        <h1 className="mb-1 text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          <span style={{ color: "#2f9be0" }}>IWI</span> Sales Performance
        </h1>
        <p className="mb-6 text-xs" style={{ color: "var(--text-muted)" }}>
          Sign in to continue
        </p>
        <label className="hud-heading mb-1 block text-xs" style={{ color: "var(--text-secondary)" }} htmlFor="username">
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          required
          autoFocus
          className="mb-4 w-full rounded border bg-transparent px-3 py-2 outline-none"
          style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
        />
        <label className="hud-heading mb-1 block text-xs" style={{ color: "var(--text-secondary)" }} htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
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
