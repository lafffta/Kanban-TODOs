"use client";

import { useActionState } from "react";
import type { AuthActionState } from "./actions";

type AuthAction = (
  prev: AuthActionState,
  formData: FormData,
) => Promise<AuthActionState>;

const inputClass =
  "w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50";

export function AuthForm({
  title,
  subtitle,
  action,
  submitLabel,
  showName = false,
  next,
  footer,
}: {
  title: string;
  subtitle: string;
  action: AuthAction;
  submitLabel: string;
  showName?: boolean;
  /** Where to land after authenticating — an invite link, when one sent us here. */
  next?: string;
  footer: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <form
        action={formAction}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-black/10 p-8 dark:border-white/15"
      >
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm opacity-60">{subtitle}</p>
        </div>

        {next && <input type="hidden" name="next" value={next} />}

        {showName && (
          <input
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Name (optional)"
            className={inputClass}
          />
        )}
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className={inputClass}
        />
        <input
          name="password"
          type="password"
          required
          autoComplete={showName ? "new-password" : "current-password"}
          placeholder="Password"
          className={inputClass}
        />

        {state?.error && (
          <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {pending ? "…" : submitLabel}
        </button>

        <p className="text-center text-sm opacity-70">{footer}</p>
      </form>
    </main>
  );
}
