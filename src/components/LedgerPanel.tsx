"use client";

import type { Autopsy } from "@/lib/ledger";
import { explorerTxUrl } from "@/lib/solana";
import type { Attempt } from "@/lib/ledger";

function downloadCsv(ledger: Attempt[]) {
  const head = "time,symbol,amount_usd,dex_price,mark_price,premium_bps,decision,tx, est_saved_usd";
  const lines = ledger.map((a) =>
    [
      new Date(a.ts).toISOString(),
      a.symbol,
      a.amountUsd,
      a.dexPrice,
      a.markPrice ?? "",
      a.premiumBps,
      a.decision,
      a.txSig ?? "",
      (a.savedUsd ?? 0).toFixed(2),
    ].join(",")
  );
  const blob = new Blob([[head, ...lines].join("\n")], { type: "text/csv" });
  const u = URL.createObjectURL(blob);
  const el = document.createElement("a");
  el.href = u;
  el.download = "fairbuy-ledger.csv";
  el.click();
  URL.revokeObjectURL(u);
}

export default function LedgerPanel({
  ledger,
  autopsy,
  onApplyTighter,
}: {
  ledger: Attempt[];
  autopsy: Autopsy;
  onApplyTighter: () => void;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-300">OVERPAY LEDGER · AUTOPSY</h2>
        {ledger.length > 0 && (
          <button onClick={() => downloadCsv(ledger)} className="text-[11px] px-2 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500">
            Export CSV
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center mb-3">
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-2">
          <div className="text-lg font-bold font-mono">{autopsy.attempts}</div>
          <div className="text-[10px] text-zinc-500">attempts</div>
        </div>
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-2">
          <div className="text-lg font-bold font-mono text-red-300">{autopsy.blocks}</div>
          <div className="text-[10px] text-zinc-500">blocked</div>
        </div>
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-2">
          <div className="text-lg font-bold font-mono text-emerald-300">${autopsy.totalSavedUsd.toFixed(0)}</div>
          <div className="text-[10px] text-zinc-500">est. saved</div>
        </div>
      </div>
      <ul className="space-y-1.5 text-xs text-zinc-300">
        {autopsy.notes.map((n, i) => (
          <li key={i} className="rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1.5">◈ {n}</li>
        ))}
      </ul>
      {autopsy.suggestedMaxPremiumBps !== null && (
        <button
          onClick={onApplyTighter}
          className="mt-2 w-full text-xs font-semibold rounded-xl bg-amber-400/15 border border-amber-400/40 text-amber-200 py-2 hover:bg-amber-400/25"
        >
          Apply tighter band (+{(autopsy.suggestedMaxPremiumBps / 100).toFixed(0)}%) — the ledger learned
        </button>
      )}
      {ledger.length > 0 && (
        <div className="mt-3 space-y-1 max-h-40 overflow-auto">
          {ledger.slice(0, 8).map((a) => (
            <div key={a.id} className="text-[11px] font-mono text-zinc-500 flex justify-between gap-2">
              <span>
                {new Date(a.ts).toLocaleTimeString()} · {a.symbol} · {a.decision} · +{(a.premiumBps / 100).toFixed(1)}%
                {a.status && a.status !== "submitted" && (
                  <span
                    className={
                      a.status === "confirmed"
                        ? " text-emerald-400"
                        : a.status === "failed"
                          ? " text-red-400"
                          : " text-zinc-600"
                    }
                  >
                    {" "}
                    {a.status === "confirmed" ? "✓ filled" : a.status === "failed" ? "✗ failed on-chain" : "? unverified"}
                  </span>
                )}
              </span>
              {a.txSig && (
                <a className="text-emerald-400 underline" href={explorerTxUrl(a.txSig)} target="_blank" rel="noreferrer">
                  tx↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
