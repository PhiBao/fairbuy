"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  updateAttemptStatus,
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

export interface ListedState {
  dexPrice: number | null;
  impactBps: number;
  underlying: number | null;
  divergenceBps: number | null;
  live: boolean;
}

/** Headless reporter: polls dex probe + underlying for one listed token. */
function ListedQuoteReporter({
  symbol,
  onUpdate,
}: {
  symbol: string;
  onUpdate: (symbol: string, s: ListedState) => void;
}) {
  const cb = useRef(onUpdate);
  useEffect(() => {
    cb.current = onUpdate;
  }, [onUpdate]);
  useEffect(() => {
    const cfg = XSTOCKS_PINNED[symbol];
    if (!cfg) return;
    let stop = false;
    async function load() {
      try {
        const [dq, pq] = await Promise.all([
          fetch(`/api/dexprice?mint=${cfg.mint}&decimals=${cfg.decimals}`),
          fetch(`/api/pyth?symbol=${cfg.equity}`),
        ]);
        const dj = await dq.json();
        const pj = await pq.json();
        if (stop) return;
        const dex = dj.live ? dj.price : null;
        const und = pj.live ? pj.price : null;
        cb.current(symbol, {
          dexPrice: dex,
          impactBps: dj.live ? (dj.impactBps ?? 0) : 0,
          underlying: und,
          divergenceBps:
            dex !== null && und !== null && und > 0
              ? Math.round((Math.abs(dex - und) / und) * 10000)
              : null,
          live: !!(dj.live && pj.live),
        });
      } catch {
        if (!stop)
          cb.current(symbol, { dexPrice: null, impactBps: 0, underlying: null, divergenceBps: null, live: false });
      }
    }
    load();
    const id = setInterval(load, 20_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [symbol]);
  return null;
}

interface Alert {
  symbol: string;
  text: string;
}

export default function Home() {
  const [marks, setMarks] = useState<{ rows: MarkRow[]; live: boolean; warning?: string; cachedAt?: number | null } | null>(null);
  const [selected, setSelected] = useState("OPENAI");
  const [touched, setTouched] = useState(false);
  const [flash, setFlash] = useState(false);
  const guardRef = useRef<HTMLDivElement | null>(null);
  const [maxPremium, setMaxPremium] = useState<number>(loadMaxPremiumBps());
  const [ledger, setLedger] = useState<Attempt[]>([]);
  const [watch, setWatch] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [notified, setNotified] = useState<Set<string>>(new Set());
  const [listed, setListed] = useState<Record<string, ListedState>>({});

  // Listed-leg flow + session state for the selected token
  const [underlying, setUnderlying] = useState<UnderlyingState | null>(null);
  const [smartFlow, setSmartFlow] = useState<number | null>(null);
  const [freshFlow, setFreshFlow] = useState<number | null>(null);

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

  useEffect(() => {
    loadMarks();
    const id = setInterval(loadMarks, 20_000);
    return () => clearInterval(id);
  }, [loadMarks]);

  const onListedUpdate = useCallback((symbol: string, s: ListedState) => {
    setListed((m) => (m[symbol]?.dexPrice === s.dexPrice && m[symbol]?.underlying === s.underlying && m[symbol]?.live === s.live ? m : { ...m, [symbol]: s }));
  }, []);

  const rows: MarkRow[] = useMemo(() => {
    const base = marks?.rows ?? [];
    const extra: MarkRow[] = [];
    for (const [symbol, cfg] of Object.entries(XSTOCKS_PINNED)) {
      const st = listed[symbol];
      if (st?.dexPrice !== null && st?.dexPrice !== undefined && st?.underlying) {
        extra.push({
          symbol,
          mint: cfg.mint,
          markPrice: st.underlying,
          tokenPrice: st.dexPrice,
          premiumBps: Math.round(((st.dexPrice - st.underlying) / st.underlying) * 10000),
          supply: 0,
          image: "",
        });
      }
    }
    return [...base, ...extra];
  }, [marks, listed]);

  // Demo robustness: lead with the live max premium until the user takes over.
  useEffect(() => {
    if (!touched && rows.length > 0) {
      const top = [...rows].sort((a, b) => b.premiumBps - a.premiumBps)[0];
      if (top && top.symbol !== selected) setSelected(top.symbol);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, touched]);

  // Watchlist alerts: watched token back inside band.
  useEffect(() => {
    if (rows.length === 0) return;
    const fresh: Alert[] = [];
    const nn = new Set(notified);
    for (const w of watch) {
      const row = rows.find((r) => r.symbol === w);
      if (row && row.premiumBps <= maxPremium && !nn.has(`${w}:${row.premiumBps}`)) {
        fresh.push({
          symbol: w,
          text: `${w} back in band: ${row.premiumBps >= 0 ? "+" : ""}${(row.premiumBps / 100).toFixed(1)}% (fair $${row.markPrice.toFixed(2)})`,
        });
        nn.add(`${w}:${row.premiumBps}`);
      }
    }
    if (fresh.length) {
      setAlerts((a) => [...fresh, ...a].slice(0, 10));
      setNotified(nn);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, watch, maxPremium]);

  const toggleWatch = (s: string) => {
    setWatch((w) => {
      const nw = w.includes(s) ? w.filter((x) => x !== s) : [...w, s];
      localStorage.setItem(WATCH_KEY, JSON.stringify(nw));
      return nw;
    });
  };

  const onArmAlert = useCallback((s: string) => {
    setWatch((w) => {
      if (w.includes(s)) return w;
      const nw = [...w, s];
      localStorage.setItem(WATCH_KEY, JSON.stringify(nw));
      return nw;
    });
  }, []);

  const onAttempt = useCallback((a: AttemptDraft) => {
    const rec = recordAttempt(a);
    setLedger(loadLedger());
    return rec.id;
  }, []);

  const onStatus = useCallback(
    (id: string, state: "confirmed" | "failed" | "pending" | "unknown") => {
      updateAttemptStatus(id, state === "pending" ? "unknown" : state);
      setLedger(loadLedger());
    },
    []
  );

  const memoAutopsy = useMemo(() => autopsy(ledger, maxPremium), [ledger, maxPremium]);

  const applyTighter = () => {
    if (memoAutopsy.suggestedMaxPremiumBps !== null) {
      saveMaxPremiumBps(memoAutopsy.suggestedMaxPremiumBps);
      setMaxPremium(memoAutopsy.suggestedMaxPremiumBps);
    }
  };

  const selRow = rows.find((r) => r.symbol === selected);
  const listedCfg = XSTOCKS_PINNED[selected];
  const isListed = !!listedCfg;
  const lst = isListed ? listed[selected] : undefined;
  const sessionOpen = isListed ? underlying?.isOpen : undefined;
  const offHours = isListed
    ? sessionOpen === null || sessionOpen === undefined
      ? isOffHoursET()
      : !sessionOpen
    : isOffHoursET();

  const guard: GuardInput | null = selRow
    ? {
        symbol: selRow.symbol,
        mint: selRow.mint,
        decimals: listedCfg?.decimals ?? 6,
        dexPrice: selRow.tokenPrice,
        markPrice: selRow.markPrice,
        marksLive: isListed ? !!lst?.live : (marks?.live ?? false),
        maxPremiumBps: maxPremium,
        divergenceBps: isListed ? (lst?.divergenceBps ?? null) : null,
        referenceStale: isListed ? !lst?.live : !(marks?.live ?? false),
        smartFlow: isListed ? smartFlow : null,
        freshFlow: isListed ? freshFlow : null,
        offHours,
      }
    : null;

  const select = (s: string) => {
    setTouched(true);
    setSelected(s);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 1400);
    // If the guard card is off-screen (typical on phones), bring it to the user
    // instead of making them hunt for it below the fold.
    window.requestAnimationFrame(() => {
      const el = guardRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const offscreen = r.top < 8 || r.bottom > window.innerHeight - 8;
      if (offscreen) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 space-y-4">
      {Object.keys(XSTOCKS_PINNED).map((s) => (
        <ListedQuoteReporter key={s} symbol={s} onUpdate={onListedUpdate} />
      ))}
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
            <button key={i} onClick={() => select(a.symbol)} className="block text-left text-emerald-200 hover:underline">
              🔔 {a.text} — tap to fill →
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="lg:col-start-1 lg:row-start-1">
          {marks ? (
            <TokenBoard
              rows={rows}
              live={marks.live}
              warning={marks.warning}
              selected={selected}
              onSelect={select}
            />
          ) : (
            <div className="rounded-2xl border border-zinc-800 p-4 text-sm text-zinc-500">Loading marks…</div>
          )}
        </div>

        <div
          ref={guardRef}
          className={`scroll-mt-4 rounded-2xl transition-shadow duration-500 ${
            flash ? "ring-2 ring-emerald-400/70 shadow-[0_0_40px_-8px] shadow-emerald-400/40" : ""
          }`}
        >
          {guard ? (
            <GuardCard key={guard.symbol} g={guard} onAttempt={onAttempt} onArmAlert={onArmAlert} onStatus={onStatus} />
          ) : (
            <div className="rounded-2xl border border-zinc-800 p-4 text-sm text-zinc-500">Select a token…</div>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 lg:col-start-1 lg:row-start-2">
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

        {isListed && listedCfg && (
          <div className="space-y-4 lg:col-start-2 lg:row-start-2" key={selected}>
            <PythBadge symbol={listedCfg.equity} onUpdate={setUnderlying} />
            <FlowCard
              mint={listedCfg.mint}
              onFlows={(s, f) => {
                setSmartFlow(s);
                setFreshFlow(f);
              }}
            />
          </div>
        )}

        <div className="lg:col-start-1 lg:row-start-3">
          <LedgerPanel ledger={ledger} autopsy={memoAutopsy} onApplyTighter={applyTighter} />
        </div>
      </div>

      <footer className="text-[11px] text-zinc-600 pt-2">
        FairBuy composes PreStocks marks, Pyth registry session data, Jupiter routing, and Nansen
        TGM aggregates (redistribution-allowed endpoints, transformed). No custody — you sign every
        fill. Marks are issuer references, not oracles.
      </footer>
    </main>
  );
}
