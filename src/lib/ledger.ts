// Overpay Ledger: every attempt logged with regime context; autopsy surfaces
// repeat patterns and tightens policy. The self-learning loop, deterministic.

import type { Decision } from "./policy";
import { DEFAULT_MAX_PREMIUM_BPS } from "./policy";

export interface Attempt {
  id: string;
  ts: number;
  symbol: string;
  amountUsd: number;
  dexPrice: number;
  markPrice: number | null;
  premiumBps: number;
  decision: Decision;
  txSig?: string;
  savedUsd: number;
  offHours: boolean;
}

const KEY = "fairbuy-ledger-v1";
const POLICY_KEY = "fairbuy-policy-v1";

export function loadLedger(): Attempt[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Attempt[];
  } catch {
    return [];
  }
}

export function recordAttempt(a: Omit<Attempt, "id" | "ts">): Attempt {
  const full: Attempt = {
    ...a,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
  };
  if (typeof window !== "undefined") {
    const cur = loadLedger();
    localStorage.setItem(KEY, JSON.stringify([full, ...cur].slice(0, 200)));
  }
  return full;
}

export function loadMaxPremiumBps(): number {
  if (typeof window === "undefined") return DEFAULT_MAX_PREMIUM_BPS;
  const v = Number(localStorage.getItem(POLICY_KEY));
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_PREMIUM_BPS;
}

export function saveMaxPremiumBps(v: number): void {
  if (typeof window !== "undefined") localStorage.setItem(POLICY_KEY, String(v));
}

export interface Autopsy {
  attempts: number;
  blocks: number;
  fills: number;
  totalSavedUsd: number;
  offHoursOverpayRate: number | null;
  notes: string[];
  suggestedMaxPremiumBps: number | null;
}

/** Deterministic autopsy over the ledger. */
export function autopsy(ledger: Attempt[], currentMax: number): Autopsy {
  const attempts = ledger.length;
  const blocks = ledger.filter((a) => a.decision === "BLOCK").length;
  const fills = attempts - blocks;
  const totalSavedUsd = ledger.reduce((s, a) => s + (a.savedUsd || 0), 0);
  const offHours = ledger.filter((a) => a.offHours);
  const offHoursOverpayRate =
    offHours.length >= 2
      ? offHours.filter((a) => a.premiumBps > currentMax).length / offHours.length
      : null;

  const notes: string[] = [];
  if (attempts === 0) notes.push("No attempts yet — your first guarded buy starts the ledger.");
  if (blocks > 0) notes.push(`${blocks} overpay blocked before it cost you.`);
  if (totalSavedUsd > 1) notes.push(`Blocks saved an estimated $${totalSavedUsd.toFixed(0)} vs mark.`);
  if (offHoursOverpayRate !== null && offHoursOverpayRate >= 0.5)
    notes.push(`You overpay ${(offHoursOverpayRate * 100).toFixed(0)}% of the time off-hours — consider Fair-Limit by default at night.`);
  const fomo = ledger.filter((a) => a.premiumBps > 2000).length;
  if (fomo >= 2) notes.push(`${fomo} attempts chased +20% premiums — the guard auto-tightened your band.`);

  // Auto-tighten: 2+ FOMO chases => suggest lower band, floor 300bps.
  const suggestedMaxPremiumBps = fomo >= 2 ? Math.max(300, Math.floor(currentMax * 0.7)) : null;

  return { attempts, blocks, fills, totalSavedUsd, offHoursOverpayRate, notes, suggestedMaxPremiumBps };
}
