// Fair-value policy engine. Pure deterministic math — the block lives in code,
// never in a prompt. All percentages below are in basis points.

export type Decision = "BLOCK" | "WARN" | "FAIR_LIMIT" | "OK";

export interface PolicyInput {
  /** (dex - mark) / mark * 10000. Negative = discount. */
  premiumBps: number;
  /** Expected price impact of this size in bps (from Jupiter quote). */
  impactBps: number;
  /** |pythEquity - pythCrypto| / pythEquity * 10000 (listed leg). Null when unavailable. */
  divergenceBps: number | null;
  /** True when any reference price is stale beyond tolerance. */
  referenceStale: boolean;
  /** User max acceptable premium, bps. Adaptive default tightens from ledger autopsy. */
  maxPremiumBps: number;
}

export interface PolicyResult {
  decision: Decision;
  reasons: string[];
  /** Suggested fair-limit price = mark * (1 + maxPremiumBps). Null when no mark. */
  fairLimitBpsOverMark: number | null;
  /** Estimated overpay in USD for amountUsd at current dex price vs mark. */
  savedUsdEstimate: (amountUsd: number) => number;
}

export const DEFAULT_MAX_PREMIUM_BPS = 1000; // +10%
export const HARD_BLOCK_MULTIPLE = 2; // premium > 2x max => hard block
export const MAX_IMPACT_BPS = 200; // >2% impact forces limit

export function premiumBps(dexPrice: number, markPrice: number): number {
  if (!isFinite(dexPrice) || !isFinite(markPrice) || markPrice <= 0) return NaN;
  return ((dexPrice - markPrice) / markPrice) * 10000;
}

export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const reasons: string[] = [];
  const { premiumBps: prem, impactBps, divergenceBps, referenceStale, maxPremiumBps } = input;

  if (referenceStale) {
    reasons.push("Reference price is stale — market-buy disabled until fresh.");
    return { decision: "BLOCK", reasons, fairLimitBpsOverMark: null, savedUsdEstimate: () => 0 };
  }
  if (!isFinite(prem)) {
    reasons.push("No reliable fair reference — market-buy disabled.");
    return { decision: "BLOCK", reasons, fairLimitBpsOverMark: null, savedUsdEstimate: () => 0 };
  }
  if (prem > maxPremiumBps * HARD_BLOCK_MULTIPLE) {
    reasons.push(
      `Premium +${(prem / 100).toFixed(1)}% exceeds hard block at +${((maxPremiumBps * HARD_BLOCK_MULTIPLE) / 100).toFixed(0)}%.`
    );
    return {
      decision: "BLOCK",
      reasons,
      fairLimitBpsOverMark: maxPremiumBps,
      savedUsdEstimate: (usd) => Math.max(0, (usd * prem) / (10000 + prem)),
    };
  }
  if (prem > maxPremiumBps) {
    reasons.push(`Premium +${(prem / 100).toFixed(1)}% exceeds your max +${(maxPremiumBps / 100).toFixed(0)}% — Fair-Limit required.`);
  }
  if (impactBps > MAX_IMPACT_BPS) {
    reasons.push(`Quote impact ${(impactBps / 100).toFixed(2)}% is thin — limit order required.`);
  }
  if (divergenceBps !== null && divergenceBps > 500) {
    reasons.push(`On/off-chain divergence ${(divergenceBps / 100).toFixed(2)}% — execution disciplined to limit.`);
  }
  if (prem < 0) {
    reasons.push(`Trading at a ${(Math.abs(prem) / 100).toFixed(1)}% discount to mark — size with care (thin book).`);
  }

  const decision: Decision =
    prem > maxPremiumBps || impactBps > MAX_IMPACT_BPS || (divergenceBps !== null && divergenceBps > 500)
      ? "FAIR_LIMIT"
      : prem > maxPremiumBps / 2
        ? "WARN"
        : "OK";
  if (decision === "WARN") reasons.push("Premium is elevated but inside your band — confirm to proceed.");
  if (decision === "OK") reasons.push("Inside fair band. Proceed.");

  return {
    decision,
    reasons,
    fairLimitBpsOverMark: maxPremiumBps,
    savedUsdEstimate: (usd) => (prem > 0 ? Math.max(0, (usd * prem) / (10000 + prem)) : 0),
  };
}

/** Fair-limit price from mark + allowed premium. */
export function fairLimitPrice(markPrice: number, maxPremiumBps: number): number {
  return markPrice * (1 + maxPremiumBps / 10000);
}
