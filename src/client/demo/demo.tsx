// Only included in the online demo build (vite --mode demo).
import { useState } from 'react';

/** Register the demo service worker and wait until it is answering this page's requests. */
export async function startDemoWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('This browser does not support the technology the demo needs. Try a current version of Chrome, Edge, Firefox or Safari.');
  }
  const registration = await navigator.serviceWorker.register('./sw.js');
  if (navigator.serviceWorker.controller) return;

  await new Promise<void>((resolve) => {
    navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    // After a hard refresh the worker is already running but not yet in charge of this page.
    const ask = () => (registration.active ?? registration.waiting ?? registration.installing)?.postMessage('claim');
    ask();
    const timer = setInterval(() => {
      if (navigator.serviceWorker.controller) {
        clearInterval(timer);
        resolve();
      } else {
        ask();
      }
    }, 300);
  });
}

export function DemoBanner({ error }: { error?: string }) {
  const [resetting, setResetting] = useState(false);

  const reset = async () => {
    if (!window.confirm('Reset the demo? Your stations and settings changes will be replaced with the originals.')) return;
    setResetting(true);
    await fetch('/api/__demo/reset', { method: 'POST' }).catch(() => undefined);
    window.location.reload();
  };

  return (
    <div className="bg-amber-100 dark:bg-amber-950/60 text-amber-950 dark:text-amber-100 border-b border-amber-300 dark:border-amber-900 text-xs sm:text-sm">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">Live demo</span>
        {error ? (
          <span>{error}</span>
        ) : (
          <span className="opacity-90">
            <span className="sm:hidden">Fictional music, saved in this browser only.</span>
            <span className="hidden sm:inline">
              Fictional music and generated audio. Changes are saved only in this browser.
            </span>
          </span>
        )}
        <span className="flex items-center gap-3 ml-auto">
          {!error && (
            <button
              type="button"
              onClick={reset}
              disabled={resetting}
              className="underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
            >
              {resetting ? 'Resetting…' : 'Reset demo'}
            </button>
          )}
          <a
            href="https://github.com/peanutismint/radiarr#install"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline underline-offset-2 hover:opacity-80"
          >
            Get Radiarr
          </a>
        </span>
      </div>
    </div>
  );
}
