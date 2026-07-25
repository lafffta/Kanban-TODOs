"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The custom install affordance (D8).
 *
 * Chromium fires `beforeinstallprompt` when it decides the app is installable and
 * suppresses its own banner if the event is cancelled. Cancelling it and keeping
 * the event is what buys the right to prompt from a button of ours, at a moment
 * that makes sense — next to the boards list, where "put this on my phone" is a
 * thought someone might actually have.
 *
 * Browsers that don't fire it (Safari installs via the share sheet, and every
 * browser once the app is already installed) simply render nothing.
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallButton() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const capture = (event: Event) => {
      // Suppress the browser's own banner; ours takes over from here.
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const installed = () => setPrompt(null);

    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  const install = useCallback(async () => {
    if (!prompt) return;
    await prompt.prompt();
    // Each captured event may be used once. Whichever way the choice went, this
    // one is spent; a browser that still considers the app installable will fire
    // another `beforeinstallprompt` later.
    await prompt.userChoice;
    setPrompt(null);
  }, [prompt]);

  if (!prompt) return null;

  return (
    <button
      type="button"
      onClick={install}
      className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20"
    >
      Install app
    </button>
  );
}
