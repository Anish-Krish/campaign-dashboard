"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, undefined);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
      <form
        action={formAction}
        className="w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-900 p-8"
      >
        <h1 className="mb-6 text-xl font-semibold text-neutral-100">
          Campaign Dashboard
        </h1>
        <label className="mb-1 block text-sm text-neutral-400" htmlFor="password">
          Team password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          className="mb-4 w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-neutral-100 outline-none focus:border-blue-500"
        />
        {state?.error && (
          <p className="mb-4 text-sm text-red-400">{state.error}</p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
