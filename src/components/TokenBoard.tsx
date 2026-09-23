"use client";

export interface MarkRow {
  symbol: string;
  mint: string;
  markPrice: number;
  tokenPrice: number;
  premiumBps: number;
  supply: number;
  image: string;
}

function badgeClass(premiumBps: number): string {
  if (premiumBps > 2000) return "bg-red-500/15 text-red-300 border-red-500/40";
  if (premiumBps > 1000) return "bg-orange-500/15 text-orange-300 border-orange-500/40";
  if (premiumBps > 0) return "bg-yellow-500/15 text-yellow-300 border-yellow-500/40";
  return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
}

function fmtPremium(bps: number): string {
  const pct = bps / 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export default function TokenBoard({
  rows,
  live,
  warning,
  selected,
  onSelect,
}: {
  rows: MarkRow[];
  live: boolean;
  warning?: string;
  selected: string;
  onSelect: (symbol: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-300">PRE-IPO BOARD · MARK vs DEX</h2>
        <span
          className={`text-[11px] px-2 py-0.5 rounded-full border ${live ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/40" : "bg-amber-500/10 text-amber-300 border-amber-500/40"}`}
        >
          {live ? "● LIVE" : "◌ CACHED"}
        </span>
      </div>
      {!live && warning && <p className="text-xs text-amber-300/90 mb-3">{warning}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {rows.map((r) => (
          <button
            key={r.symbol}
            onClick={() => onSelect(r.symbol)}
            className={`text-left rounded-xl border p-3 transition hover:border-zinc-500 ${
              selected === r.symbol ? "border-emerald-400/70 bg-zinc-800/80" : "border-zinc-800 bg-zinc-900"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">{r.symbol}</span>
              <span className={`text-xs font-mono px-2 py-0.5 rounded-full border ${badgeClass(r.premiumBps)}`}>
                {fmtPremium(r.premiumBps)}
              </span>
            </div>
            <div className="mt-1.5 text-xs text-zinc-400 font-mono">
              mark ${r.markPrice.toFixed(2)} · dex ${r.tokenPrice.toFixed(2)}
            </div>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-zinc-500">
        Mark = PreStocks issuer reference (SPV exposure value), not an oracle. DEX = secondary price on Meteora DLMM via Jupiter routing.
      </p>
    </div>
  );
}
