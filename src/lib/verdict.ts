// Verdict object: deterministic policy owns the decision; Jev adds semantics.
// Rendered as calibrated probabilities, never prose.

export type VerdictOption = "buy_now" | "limit_at_fair" | "wait_for_convergence" | "skip_thin";

export interface Verdict {
  options: Record<VerdictOption, number>;
  choice: VerdictOption;
  chaseRisk: number; // 0..1
  entryQuality: number; // 0..100
  confidence: number; // 0..1
  source: "jev" | "deterministic" | "offline";
}

export interface VerdictState {
  premiumBps: number;
  impactBps: number;
  divergenceBps: number | null;
  smartTraderNetFlowUsd: number | null;
  freshNetFlowUsd: number | null;
  offHours: boolean;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Fully deterministic verdict — always available, owns the decision. */
export function deterministicVerdict(s: VerdictState): Verdict {
  const prem = s.premiumBps;
  let options: Record<VerdictOption, number>;
  if (!isFinite(prem)) {
    options = { buy_now: 0.05, limit_at_fair: 0.15, wait_for_convergence: 0.2, skip_thin: 0.6 };
  } else if (prem > 2000) {
    options = { buy_now: 0.02, limit_at_fair: 0.28, wait_for_convergence: 0.55, skip_thin: 0.15 };
  } else if (prem > 1000) {
    options = { buy_now: 0.1, limit_at_fair: 0.55, wait_for_convergence: 0.25, skip_thin: 0.1 };
  } else if (prem > 0) {
    options = { buy_now: 0.45, limit_at_fair: 0.35, wait_for_convergence: 0.1, skip_thin: 0.1 };
  } else {
    options = { buy_now: 0.55, limit_at_fair: 0.25, wait_for_convergence: 0.05, skip_thin: 0.15 };
  }
  // Thin-book penalty shifts mass from buy_now to skip_thin.
  if (s.impactBps > 200) {
    const shift = Math.min(0.3, options.buy_now * 0.6);
    options = { ...options, buy_now: options.buy_now - shift, skip_thin: options.skip_thin + shift };
  }
  const choice = (Object.entries(options).sort((a, b) => b[1] - a[1])[0][0] as VerdictOption);

  const chaseRisk = clamp01(
    (isFinite(prem) && prem > 0 ? Math.min(0.6, prem / 5000) : 0) +
      (s.freshNetFlowUsd !== null && s.freshNetFlowUsd > 0 && (s.smartTraderNetFlowUsd ?? 0) < 0 ? 0.25 : 0) +
      (s.offHours ? 0.1 : 0)
  );
  const entryQuality = Math.round(
    clamp01(1 - chaseRisk - (s.impactBps > 200 ? 0.15 : 0)) * 100
  );
  const confidence = clamp01(0.55 + (isFinite(prem) ? 0.2 : 0) + (s.smartTraderNetFlowUsd !== null ? 0.1 : 0));

  return { options, choice, chaseRisk, entryQuality, confidence, source: "deterministic" };
}
