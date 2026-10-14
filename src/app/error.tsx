"use client";

import { useEffect } from "react";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16">
      <div className="rounded-2xl border border-red-500/40 bg-red-500/5 p-6">
        <h2 className="text-lg font-semibold text-red-200">This panel hit an error — the guard is still intact.</h2>
        <p className="text-sm text-zinc-400 mt-2">
          Bad fills are blocked in the policy engine, not in the UI, so a display error can never let one through.
        </p>
        <p className="text-xs text-zinc-500 mt-3 font-mono break-all">{error.message}</p>
        <button
          onClick={retry}
          className="mt-5 rounded-xl px-4 py-2 text-sm font-semibold bg-emerald-400/15 border border-emerald-400/40 text-emerald-200 hover:bg-emerald-400/25"
        >
          Reload the view
        </button>
      </div>
    </main>
  );
}
