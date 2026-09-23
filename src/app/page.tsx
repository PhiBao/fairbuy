"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TokenBoard, { type MarkRow } from "@/components/TokenBoard";
import GuardCard, { type AttemptDraft, type GuardInput } from "@/components/GuardCard";
import PythBadge, { type UnderlyingState } from "@/components/PythBadge";
import FlowCard from "@/components/FlowCard";
import LedgerPanel from "@/components/LedgerPanel";
import { XSTOCKS_PINNED } from "@/lib/tokens";
import {
  autopsy,
  loadLedger,
  loadMaxPremiumBps,
  recordAttempt,
  saveMaxPremiumBps,
  type Attempt,
} from "@/lib/ledger";

function isOffHoursET(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(wd);
  return !(weekday && mins >= 570 && mins < 960); // 9:30–16:00 ET
}

const WATCH_KEY = "fairbuy-watch-v1";

export default function Home() {
  const [marks, setMarks] = useState<{ rows: MarkRow[]; live: boolean; warning?: string; cachedAt?: number | null } | null>(null);
  const [selected, setSelected] = useState("OPENAI");
  const [maxPremium, setMaxPremium] = useState<number>(loadMaxPremiumBps());
  const [ledger, setLedger] = useState<Attempt[]>([]);
  const [watch, setWatch] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [notified, setNotified] = useState<Set<string>>(new Set());

  // Listed leg (NVDAx): underlying reference + onchain probe
  const [underlying, setUnderlying] = useState<UnderlyingState | null>(null);
  const [dexProbe, setDexProbe] = useState<{ price: number; impactBps: number } | null>(null);
  const [smartFlow, setSmartFlow] = useState<number | null>(null);
  const [freshFlow, setFreshFlow] = useState<number | null>(null);

  const nvda = XSTOCKS_PINNED.NVDAx;

  useEffect(() => {
    setLedger(loadLedger());
    try {
      setWatch(JSON.parse(localStorage.getItem(WATCH_KEY) ?? "[]") as string[]);
    } catch {
      /* ignore */
    }
  }, []);

  const loadMarks = useCallback(async () => {
    try {
      const r = await fetch("/api/marks");
      const j = await r.json();
      setMarks(j);
    } catch {
      /* keep previous */
    }
  }, []);

  const loadDexProbe = useCallback(async () => {
    try {
      const r = await fetch(`/api/dexprice?mint=${nvda.mint}&decimals=${nvda.decimals}`);
      const j = await r.json();
      if (j.live) setDexProbe({ price: j.price, impactBps: j.impactBps });
      else setDexProbe(null);
    } catch {
      setDexProbe(null);
    }
  }, [nvda.mint, nvda.decimals]);

  useEffect(() => {
    loadMarks();
    loadDexProbe();
    const id = setInterval(() => {
      loadMarks();
      loadDexProbe();
    }, 20_000);
    return () => clearInterval(id);
  }, [loadMarks, loadDexProbe]);

  // Watchlist alerts: watched token back inside band.
  useEffect(() => {
    if (!marks?.rows) return;
    const fresh: string[] = [];
    const nn = new Set(notified);
    for (const w of watch) {
      const row = marks.rows.find((r) => r.symbol === w);
      if (row && row.premiumBps <= maxPremium && !nn.has(`${w}:${row.premiumBps}`)) {
        fresh.push(`${w} back in band: ${row.premiumBps >= 0 ? "+" : ""}${(row.premiumBps / 100).toFixed(1)}% (mark $${row.markPrice.toFixed(2)})`);
        nn.add(`${w}:${row.premiumBps}`);
      }
    }
    if (fresh.length) {
      setAlerts((a) => [...fresh, ...a].slice(0, 10));
      setNotified(nn);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, watch, maxPremium]);

  const toggleWatch = (s: string) => {
    setWatch((w) => {
      const nw = w.includes(s) ? w.filter((x) => x !== s) : [...w, s];
      localStorage.setItem(WATCH_KEY, JSON.stringify(nw));
      return nw;
    });
  };

  const onAttempt = useCallback((a: AttemptDraft) => {
    recordAttempt(a);
    setLedger(loadLedger());
  }, []);

  const memoAutopsy = useMemo(() => autopsy(ledger, maxPremium), [ledger, maxPremium]);

  const applyTighter = () => {
    if (memoAutopsy.suggestedMaxPremiumBps !== null) {
      saveMaxPremiumBps(memoAutopsy.suggestedMaxPremiumBps);
      setMaxPremium(memoAutopsy.suggestedMaxPremiumBps);
    }
  };

  const divergenceBps =
    dexProbe && underlying?.price
      ? Math.round((Math.abs(dexProbe.price - underlying.price) / underlying.price) * 10000)
      : null;

  const rows: MarkRow[] = useMemo(() => {
    const base = marks?.rows ?? [];
    if (dexProbe && underlying?.price && underlying.price > 0) {
      const prem = Math.round(((dexProbe.price - underlying.price) / underlying.price) * 10000);
      return [
        ...base,
        { symbol: "NVDAx", mint: nvda.mint, markPrice: underlying.price, tokenPrice: dexProbe.price, premiumBps: prem, supply: 0, image: "" },
      ];
    }
    return base;
  }, [marks, dexProbe, underlying, nvda.mint]);

  const selRow = rows.find((r) => r.symbol === selected);
  const isListed = selected === "NVDAx";
  const sessionOpen = underlying?.isOpen;
  const offHours = sessionOpen === null || sessionOpen === undefined ? isOffHoursET() : !sessionOpen;

  const guard: GuardInput | null = selRow
    ? {
        symbol: selRow.symbol,
        mint: selRow.mint,
        dexPrice: selRow.tokenPrice,
        markPrice: selRow.markPrice,
        marksLive: isListed ? !!(dexProbe && underlying?.live) : (marks?.live ?? false),
        maxPremiumBps: maxPremium,
        divergenceBps: isListed ? divergenceBps : null,
        referenceStale: isListed ? !(dexProbe && underlying?.live) : !(marks?.live ?? false),
        smartFlow: isListed ? smartFlow : null,
        freshFlow: isListed ? freshFlow : null,
        offHours,
      }
    : null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            FairBuy <span className="text-emerald-400">·</span>{" "}
            <span className="text-base font-medium text-zinc-400">never overpay for stocks on Solana</span>
          </h1>
          <p className="text-xs text-zinc-500 mt-1">
            Fair reference beside every quote. The guard blocks what a brokerage would never let through.{" "}
            {offHours ? (
              <span className="text-amber-300">US market closed — onchain prices lead.</span>
            ) : (
              <span className="text-emerald-300">US market open.</span>
            )}
          </p>
        </div>
        <label className="text-xs text-zinc-400 flex items-center gap-2">
          Max premium bps
          <input
            type="number"
            min={100}
            step={100}
            value={maxPremium}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v > 0) {
                setMaxPremium(v);
                saveMaxPremiumBps(v);
              }
            }}
            className="w-24 rounded-lg bg-zinc-900 border border-zinc-700 px-2 py-1 font-mono"
          />
          <span className="font-mono">(+{(maxPremium / 100).toFixed(0)}%)</span>
        </label>
      </header>

      {alerts.length > 0 && (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs space-y-1">
          {alerts.map((a, i) => (
            <div key={i} className="text-emerald-200">🔔 {a}</div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          {marks ? (
            <TokenBoard
              rows={rows}
              live={marks.live}
              warning={marks.warning}
              selected={selected}
              onSelect={setSelected}
            />
          ) : (
            <div className="rounded-2xl border border-zinc-800 p-4 text-sm text-zinc-500">Loading marks…</div>
          )}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-300 mb-2">WATCHLIST · PREMIUM-DROP ALERTS</h2>
            <div className="flex flex-wrap gap-1.5">
              {rows.map((r) => (
                <button
                  key={r.symbol}
                  onClick={() => toggleWatch(r.symbol)}
                  className={`text-[11px] px-2 py-1 rounded-full border font-mono ${
                    watch.includes(r.symbol)
                      ? "border-emerald-400/60 text-emerald-200 bg-emerald-400/10"
                      : "border-zinc-700 text-zinc-400"
                  }`}
                >
                  {watch.includes(r.symbol) ? "★ " : "☆ "}{r.symbol}
                </button>
              ))}
            </div>
          </div>
          <LedgerPanel ledger={ledger} autopsy={memoAutopsy} onApplyTighter={applyTighter} />
        </div>

        <div className="space-y-4">
          {guard ? (
            <GuardCard key={guard.symbol} g={guard} onAttempt={onAttempt} />
          ) : (
            <div className="rounded-2xl border border-zinc-800 p-4 text-sm text-zinc-500">Select a token…</div>
          )}
          <PythBadge symbol="NVDA" onUpdate={setUnderlying} />
          <FlowCard
            mint={nvda.mint}
            onFlows={(s, f) => {
              setSmartFlow(s);
              setFreshFlow(f);
            }}
          />
        </div>
      </div>

      <footer className="text-[11px] text-zinc-600 pt-2">
        FairBuy composes PreStocks marks, Pyth feed-registry session data, Jupiter routing, Yahoo underlying
        reference (Pyth Pro-ready feed IDs), and Nansen TGM aggregates (redistribution-allowed endpoints,
        transformed). No custody — you sign every fill. Marks are issuer references, not oracles.
      </footer>
    </main>
  );
}
