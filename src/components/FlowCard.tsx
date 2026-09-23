"use client";

import { useEffect, useState } from "react";
import type { FlowSnapshot } from "@/app/api/flows/route";

function fmtUsd(v: number | null): string {
  if (v === null) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "+";
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(0)}k`;
  return `${sign}$${a.toFixed(0)}`;
}

export default function FlowCard({
  mint,
  onFlows,
}: {
  mint: string;
  onFlows: (smart: number | null, fresh: number | null) => void;
}) {
  const [s, setS] = useState<FlowSnapshot | null>(null);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const r = await fetch(`/api/flows?mint=${mint}`);
        const j = (await r.json()) as FlowSnapshot;
        if (stop) return;
        setS(j);
        onFlows(j.live ? j.smartTraderNetFlowUsd : null, j.live ? j.freshNetFlowUsd : null);
      } catch {
        if (!stop) onFlows(null, null);
      }
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint]);

  if (!s) return <div className="text-xs text-zinc-500">Flows: loading…</div>;

  const sharpNegative = (s.smartTraderNetFlowUsd ?? 0) < 0 || (s.topPnlNetFlowUsd ?? 0) < 0;
  const crowdPositive = (s.freshNetFlowUsd ?? 0) > 0;
  const divergence = s.live && sharpNegative && crowdPositive;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-zinc-300">SHARP vs CROWD · 7D</span>
        <span className={s.live ? "text-emerald-300" : "text-zinc-500"}>{s.live ? "● LIVE" : "◌ OFFLINE"}</span>
      </div>
      {s.live ? (
        <div className="font-mono text-zinc-400 space-y-0.5">
          <div>top-PnL ({s.topPnlWallets}): <span className="text-zinc-200">{fmtUsd(s.topPnlNetFlowUsd)}</span></div>
          <div>smart traders ({s.smartTraderWallets}): <span className="text-zinc-200">{fmtUsd(s.smartTraderNetFlowUsd)}</span></div>
          <div>whales ({s.whaleWallets}): <span className="text-zinc-200">{fmtUsd(s.whaleNetFlowUsd)}</span></div>
          <div>fresh wallets: <span className="text-zinc-200">{fmtUsd(s.freshNetFlowUsd)}</span></div>
          {divergence && (
            <div className="pt-1 text-amber-300">⚠ sharp distributing into fresh crowd buying</div>
          )}
        </div>
      ) : (
        <div className="text-zinc-500">Flow snapshot unavailable — guard runs on price alone.</div>
      )}
      <div className="mt-1 text-[10px] text-zinc-600">Flows by Nansen API · transformed aggregate, 7d window</div>
    </div>
  );
}
