"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import { evaluatePolicy, fairLimitPrice, premiumBps as calcPremium } from "@/lib/policy";
import type { Verdict } from "@/lib/verdict";
import { USDC_MINT } from "@/lib/tokens";
import { explorerTxUrl } from "@/lib/solana";

export interface GuardInput {
  symbol: string;
  mint: string;
  dexPrice: number;
  markPrice: number | null;
  marksLive: boolean;
  maxPremiumBps: number;
  divergenceBps: number | null;
  referenceStale: boolean;
  smartFlow: number | null;
  freshFlow: number | null;
  offHours: boolean;
}

export interface AttemptDraft {
  symbol: string;
  amountUsd: number;
  dexPrice: number;
  markPrice: number | null;
  premiumBps: number;
  decision: "BLOCK" | "WARN" | "FAIR_LIMIT" | "OK";
  txSig?: string;
  savedUsd: number;
  offHours: boolean;
}

interface Receipt extends AttemptDraft {
  fairPrice: number | null;
}

const OPTION_LABEL: Record<Verdict["choice"], string> = {
  buy_now: "Buy now",
  limit_at_fair: "Limit at fair",
  wait_for_convergence: "Wait for convergence",
  skip_thin: "Skip — thin",
};

export default function GuardCard({ g, onAttempt }: { g: GuardInput; onAttempt: (a: AttemptDraft) => void }) {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();
  const [amountUsd, setAmountUsd] = useState(100);
  const [quote, setQuote] = useState<{ outAmount: string; priceImpactBps: number; raw: unknown } | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [twapN, setTwapN] = useState(3);

  const premium = useMemo(
    () => (g.markPrice !== null ? Math.round(calcPremium(g.dexPrice, g.markPrice)) : NaN),
    [g.dexPrice, g.markPrice]
  );

  // 1. Quote (USDC -> token). amount = INPUT units (USDC has 6 decimals).
  useEffect(() => {
    let stop = false;
    setQuote(null);
    setQuoteErr(null);
    if (!g.dexPrice || !(amountUsd > 0)) return;
    const usdcUnits = Math.floor(amountUsd * 1e6);
    if (usdcUnits <= 0) return;
    (async () => {
      try {
        const r = await fetch(
          `/api/quote?inputMint=${USDC_MINT}&outputMint=${g.mint}&amount=${usdcUnits}&slippageBps=50`
        );
        const j = await r.json();
        if (stop) return;
        if (j.error) {
          setQuoteErr(`No route (thin book): ${String(j.detail ?? j.error).slice(0, 120)}`);
          return;
        }
        setQuote({ outAmount: j.outAmount, priceImpactBps: j.priceImpactBps ?? 0, raw: j.quote });
      } catch {
        if (!stop) setQuoteErr("Quote failed — check connection.");
      }
    })();
    return () => {
      stop = true;
    };
  }, [g.mint, g.dexPrice, amountUsd]);

  const impactBps = quote?.priceImpactBps ?? 0;

  const policy = useMemo(
    () =>
      evaluatePolicy({
        premiumBps: premium,
        impactBps,
        divergenceBps: g.divergenceBps,
        referenceStale: g.referenceStale,
        maxPremiumBps: g.maxPremiumBps,
      }),
    [premium, impactBps, g.divergenceBps, g.referenceStale, g.maxPremiumBps]
  );

  // 2. Typed verdict (deterministic-first, Jev-enhanced, graceful offline).
  useEffect(() => {
    let stop = false;
    setVerdict(null);
    (async () => {
      try {
        const r = await fetch("/api/verdict", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            premiumBps: premium,
            impactBps,
            divergenceBps: g.divergenceBps,
            smartTraderNetFlowUsd: g.smartFlow,
            freshNetFlowUsd: g.freshFlow,
            offHours: g.offHours,
          }),
        });
        const j = (await r.json()) as Verdict;
        if (!stop) setVerdict(j);
      } catch {
        if (!stop) setVerdict(null);
      }
    })();
    return () => {
      stop = true;
    };
  }, [premium, impactBps, g.divergenceBps, g.smartFlow, g.freshFlow, g.offHours]);

  const fairPrice = g.markPrice !== null ? fairLimitPrice(g.markPrice, g.maxPremiumBps) : null;
  const savedEst = policy.savedUsdEstimate(amountUsd);

  async function execute(mode: "market" | "fairlimit") {
    setStatus(null);
    setReceipt(null);
    const draft: AttemptDraft = {
      symbol: g.symbol,
      amountUsd,
      dexPrice: g.dexPrice,
      markPrice: g.markPrice,
      premiumBps: isFinite(premium) ? premium : 0,
      decision: policy.decision,
      savedUsd: policy.decision === "BLOCK" ? savedEst : 0,
      offHours: g.offHours,
    };
    if (policy.decision === "BLOCK") {
      onAttempt(draft);
      setReceipt({ ...draft, fairPrice });
      setStatus("⛔ BLOCKED — the guard refused this fill. Estimate logged to the ledger.");
      return;
    }
    if (mode === "fairlimit" && isFinite(premium) && premium > g.maxPremiumBps) {
      const blocked: AttemptDraft = { ...draft, decision: "FAIR_LIMIT", savedUsd: savedEst };
      onAttempt(blocked);
      setReceipt({ ...blocked, fairPrice });
      setStatus("Fair-Limit not met at this price — no fill. Set an alert instead.");
      return;
    }
    if (!connected || !publicKey || !signTransaction) {
      setStatus("Connect a wallet to execute.");
      return;
    }
    if (!quote) {
      setStatus("Waiting for a live route…");
      return;
    }
    setBusy(true);
    try {
      const sw = await fetch("/api/swap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteResponse: quote.raw, userPublicKey: publicKey.toBase58() }),
      });
      const sj = await sw.json();
      if (sj.error) throw new Error(`swap build failed: ${String(sj.detail ?? sj.error).slice(0, 160)}`);
      const bytes = Uint8Array.from(atob(sj.swapTransaction as string), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(bytes);
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
      await connection.confirmTransaction(sig, "confirmed");
      const done: AttemptDraft = { ...draft, txSig: sig, savedUsd: 0 };
      onAttempt(done);
      setReceipt({ ...done, fairPrice });
      setStatus("✓ Filled — receipt verified on Solana.");
    } catch (e) {
      setStatus(`Execution failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const blocked = policy.decision === "BLOCK";

  // TWAP-at-fair: N equal slices, each re-quoted and re-checked against the
  // fair band right before signing. Any slice failing the check halts the schedule.
  async function executeTwap() {
    setStatus(null);
    setReceipt(null);
    if (!connected || !publicKey || !signTransaction) {
      setStatus("Connect a wallet to execute.");
      return;
    }
    if (policy.decision === "BLOCK" || !g.markPrice) {
      setStatus("TWAP unavailable while blocked or without a fair reference.");
      return;
    }
    const n = Math.min(10, Math.max(2, Math.floor(twapN)));
    setBusy(true);
    let filled = 0;
    let lastSig: string | undefined;
    try {
      for (let i = 0; i < n; i++) {
        const sliceUsd = amountUsd / n;
        const qr = await fetch(
          `/api/quote?inputMint=${USDC_MINT}&outputMint=${g.mint}&amount=${Math.floor(sliceUsd * 1e6)}&slippageBps=50`
        );
        const qj = await qr.json();
        if (qj.error) {
          setStatus(`Slice ${i + 1}/${n}: no route — TWAP halted after ${filled} fills.`);
          break;
        }
        const premNow = Math.round(calcPremium(g.dexPrice, g.markPrice));
        if (!isFinite(premNow) || premNow > g.maxPremiumBps) {
          setStatus(`Slice ${i + 1}/${n}: premium +${(premNow / 100).toFixed(1)}% left the band — TWAP halted after ${filled} fills.`);
          break;
        }
        const sw = await fetch("/api/swap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ quoteResponse: qj.quote, userPublicKey: publicKey.toBase58() }),
        });
        const sj = await sw.json();
        if (sj.error) throw new Error(`slice ${i + 1} build failed`);
        const bytes = Uint8Array.from(atob(sj.swapTransaction as string), (c) => c.charCodeAt(0));
        const signed = await signTransaction(VersionedTransaction.deserialize(bytes));
        const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
        await connection.confirmTransaction(sig, "confirmed");
        filled++;
        lastSig = sig;
        onAttempt({
          symbol: g.symbol,
          amountUsd: sliceUsd,
          dexPrice: g.dexPrice,
          markPrice: g.markPrice,
          premiumBps: premNow,
          decision: "FAIR_LIMIT",
          txSig: sig,
          savedUsd: 0,
          offHours: g.offHours,
        });
        setStatus(`TWAP: slice ${filled}/${n} filled…`);
      }
      setStatus(`TWAP done: ${filled}/${n} slices filled at fair. Each fill logged to the ledger.`);
      if (lastSig) setReceipt({ symbol: g.symbol, amountUsd, dexPrice: g.dexPrice, markPrice: g.markPrice, premiumBps: premium, decision: "FAIR_LIMIT", txSig: lastSig, savedUsd: 0, offHours: g.offHours, fairPrice });
    } catch (e) {
      setStatus(`TWAP stopped: ${e instanceof Error ? e.message.slice(0, 160) : String(e)} (${filled}/${n} filled)`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-2xl border p-4 ${blocked ? "border-red-500/50 bg-red-500/5" : "border-zinc-800 bg-zinc-900/60"}`}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-300">GUARDED BUY · {g.symbol}</h2>
        {verdict && (
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-violet-500/40 bg-violet-500/10 text-violet-300">
            {OPTION_LABEL[verdict.choice]} · {(verdict.chaseRisk * 100).toFixed(0)}% chase-risk
            {verdict.source === "jev" ? " · Jev" : " · offline"}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs font-mono mb-3">
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-2">
          <div className="text-zinc-500 text-[10px]">DEX</div>
          <div>${g.dexPrice.toFixed(2)}</div>
        </div>
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-2">
          <div className="text-zinc-500 text-[10px]">FAIR {g.markPrice !== null ? "" : "(n/a)"}</div>
          <div>{g.markPrice !== null ? `$${g.markPrice.toFixed(2)}` : "—"}</div>
        </div>
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-2">
          <div className="text-zinc-500 text-[10px]">PREMIUM</div>
          <div className={isFinite(premium) && premium > 0 ? "text-red-300" : "text-emerald-300"}>
            {isFinite(premium) ? `${premium >= 0 ? "+" : ""}${(premium / 100).toFixed(1)}%` : "—"}
          </div>
        </div>
      </div>

      {verdict && (
        <div className="mb-3">
          <div className="flex h-2 rounded-full overflow-hidden border border-zinc-800">
            {(Object.entries(verdict.options) as Array<[Verdict["choice"], number]>).map(([k, p]) => (
              <div
                key={k}
                title={`${OPTION_LABEL[k]} ${(p * 100).toFixed(0)}%`}
                style={{ width: `${Math.round(p * 100)}%` }}
                className={
                  k === "buy_now"
                    ? "bg-emerald-500"
                    : k === "limit_at_fair"
                      ? "bg-amber-400"
                      : k === "wait_for_convergence"
                        ? "bg-orange-500"
                        : "bg-zinc-600"
                }
              />
            ))}
          </div>
          <div className="mt-1 text-[10px] text-zinc-500 font-mono">
            {(Object.entries(verdict.options) as Array<[Verdict["choice"], number]>)
              .map(([k, p]) => `${OPTION_LABEL[k]} ${(p * 100).toFixed(0)}%`)
              .join(" · ")}
            {" · "}entry quality {verdict.entryQuality}/100
          </div>
        </div>
      )}

      <ul className="space-y-1 text-xs mb-3">
        {policy.reasons.map((r, i) => (
          <li key={i} className="text-zinc-300">▸ {r}</li>
        ))}
        {quoteErr && <li className="text-amber-300">▸ {quoteErr}</li>}
      </ul>

      {blocked && isFinite(premium) && premium > 0 && (
        <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">
          ⛔ This ${amountUsd} buy would overpay <b>${savedEst.toFixed(0)}</b> vs fair. Blocked.
          {fairPrice !== null && <span className="text-zinc-300"> Fair re-entry: <b className="font-mono">${fairPrice.toFixed(2)}</b></span>}
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <label className="text-xs text-zinc-400">USDC</label>
        <input
          type="number"
          min={1}
          value={amountUsd}
          onChange={(e) => setAmountUsd(Number(e.target.value))}
          className="w-28 rounded-lg bg-zinc-900 border border-zinc-700 px-2 py-1.5 text-sm font-mono"
        />
        <span className="text-[11px] text-zinc-500 font-mono">
          impact {quote ? `${(impactBps / 100).toFixed(2)}%` : "…"}
        </span>
      </div>

      {!connected ? (
        <WalletMultiButton />
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            disabled={busy || blocked}
            onClick={() => execute("market")}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold bg-emerald-400/15 border border-emerald-400/40 text-emerald-200 hover:bg-emerald-400/25 disabled:opacity-40"
          >
            {busy ? "Signing…" : blocked ? "Market buy — blocked" : `Guarded market buy $${amountUsd}`}
          </button>
          <button
            disabled={busy || blocked}
            onClick={() => execute("fairlimit")}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold bg-amber-400/10 border border-amber-400/40 text-amber-200 hover:bg-amber-400/20 disabled:opacity-40"
          >
            {busy ? "Signing…" : `Fair-Limit buy @ ${fairPrice !== null ? `$${fairPrice.toFixed(2)}` : "—"}`}
          </button>
        </div>
      )}
      {connected && !blocked && (
        <div className="flex items-center gap-2 mt-2">
          <label className="text-[11px] text-zinc-500">TWAP slices</label>
          <input
            type="number"
            min={2}
            max={10}
            value={twapN}
            onChange={(e) => setTwapN(Number(e.target.value))}
            className="w-16 rounded-lg bg-zinc-900 border border-zinc-700 px-2 py-1.5 text-xs font-mono"
          />
          <button
            disabled={busy}
            onClick={executeTwap}
            className="flex-1 rounded-xl py-2 text-xs font-semibold bg-sky-400/10 border border-sky-400/40 text-sky-200 hover:bg-sky-400/20 disabled:opacity-40"
          >
            {busy ? "Filling slices…" : `TWAP ${Math.min(10, Math.max(2, Math.floor(twapN)))}× @ fair (re-checked per slice)`}
          </button>
        </div>
      )}

      {status && <p className="mt-2 text-xs text-zinc-300">{status}</p>}
      {receipt?.txSig && (
        <p className="mt-2 text-xs">
          <a className="text-emerald-400 underline font-mono" href={explorerTxUrl(receipt.txSig)} target="_blank" rel="noreferrer">
            View on Solana Explorer ↗
          </a>
        </p>
      )}
    </div>
  );
}
