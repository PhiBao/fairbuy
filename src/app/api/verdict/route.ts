export const dynamic = "force-dynamic";

import { deterministicVerdict, type Verdict, type VerdictState } from "@/lib/verdict";

// Typed verdict: deterministic policy owns the decision; Jev (System One)
// adds the semantic layer over the same state. Any failure => deterministic
// verdict with source "offline". The block path never depends on the model.
export async function POST(req: Request) {
  const state = (await req.json()) as VerdictState;
  const det = deterministicVerdict(state);
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return Response.json({ ...det, source: "offline" } satisfies Verdict);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "jev-latest",
        state: {
          premium_bps: state.premiumBps,
          impact_bps: state.impactBps,
          divergence_bps: state.divergenceBps,
          smart_trader_net_flow_usd: state.smartTraderNetFlowUsd,
          fresh_net_flow_usd: state.freshNetFlowUsd,
          off_hours: state.offHours,
        },
        questions: {
          action: {
            type: "choice",
            instructions:
              "Given this onchain equity entry state, which execution policy is best? Consider premium vs fair mark, book thinness, off/on-chain divergence, and whether fresh crowd inflows dominate while sharp wallets distribute.",
            criteria: {
              buy_now: "Fair or discounted entry with healthy depth; safe to market-buy now.",
              limit_at_fair: "Elevated premium or thin book; buy only via limit at fair reference.",
              wait_for_convergence: "Large premium or sharp distribution; wait for convergence toward fair.",
              skip_thin: "No reliable reference or untradeable book; skip this entry.",
            },
          },
          chase_risk: {
            type: "noul",
            instructions: "Is entering now a high chase-risk trade (large premium and/or crowd-dominated inflow)?",
            criteria: { true: "High chase-risk entry", false: "No unusual chase risk" },
          },
        },
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`typesafe ${r.status}`);
    const j = (await r.json()) as {
      answers?: {
        action?: { choice?: string; probabilities?: Record<string, number>; confidence?: number };
        chase_risk?: { noul?: number };
      };
    };
    const a = j.answers?.action;
    const probs = a?.probabilities;
    if (!a?.choice || !probs) throw new Error("malformed verdict");
    const merged: Verdict = {
      options: {
        buy_now: probs.buy_now ?? det.options.buy_now,
        limit_at_fair: probs.limit_at_fair ?? det.options.limit_at_fair,
        wait_for_convergence: probs.wait_for_convergence ?? det.options.wait_for_convergence,
        skip_thin: probs.skip_thin ?? det.options.skip_thin,
      },
      choice: a.choice as Verdict["choice"],
      chaseRisk: j.answers?.chase_risk?.noul ?? det.chaseRisk,
      entryQuality: det.entryQuality,
      confidence: a.confidence ?? det.confidence,
      source: "jev",
    };
    return Response.json(merged);
  } catch {
    return Response.json({ ...det, source: "offline" } satisfies Verdict);
  } finally {
    clearTimeout(t);
  }
}
