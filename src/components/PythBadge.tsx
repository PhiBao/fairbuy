"use client";

import { useEffect, useState } from "react";

export interface UnderlyingState {
  price: number | null;
  source: string;
  feedId: string | null;
  isOpen: boolean | null;
  live: boolean;
}

export default function PythBadge({
  symbol,
  onUpdate,
}: {
  symbol: string;
  onUpdate: (s: UnderlyingState) => void;
}) {
  const [s, setS] = useState<UnderlyingState | null>(null);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const r = await fetch(`/api/pyth?symbol=${symbol}`);
        const j = await r.json();
        if (stop) return;
        const st: UnderlyingState = {
          price: j.live ? j.price : null,
          source: j.source ?? "unknown",
          feedId: j.feedId ?? null,
          isOpen: j.session?.isOpen ?? null,
          live: !!j.live,
        };
        setS(st);
        onUpdate(st);
      } catch {
        if (!stop) {
          const off: UnderlyingState = { price: null, source: "unknown", feedId: null, isOpen: null, live: false };
          setS(off);
          onUpdate(off);
        }
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  if (!s?.live)
    return <div className="text-xs text-zinc-500">Underlying reference: loading…</div>;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-zinc-300">UNDERLYING · {symbol}</span>
        <span className="text-emerald-300">● LIVE</span>
      </div>
      <div className="font-mono text-zinc-400">
        <div>
          reference: <span className="text-zinc-200">${s.price?.toFixed(2)}</span>{" "}
          <span className="text-zinc-600">via {s.source}</span>
        </div>
        <div>
          session:{" "}
          {s.isOpen === null ? (
            <span className="text-zinc-500">unknown</span>
          ) : s.isOpen ? (
            <span className="text-emerald-300">market open (Pyth registry)</span>
          ) : (
            <span className="text-amber-300">market closed — onchain price leads (Pyth registry)</span>
          )}
        </div>
        {s.feedId && <div className="text-zinc-600 truncate">pyth feed {s.feedId.slice(0, 12)}…</div>}
      </div>
    </div>
  );
}
