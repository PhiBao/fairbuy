# FairBuy — never overpay for stocks on Solana

The stock market is open 24/7 onchain. Brokerage guardrails didn't come with it.
FairBuy is the missing execution-safety layer: a fair reference beside every quote,
a policy engine that **blocks** overpaying fills, and a ledger that learns your patterns.

**Live demo:** _(deploy URL goes here before submission)_
**Hackathon:** Stocklana (Main + PreStocks + Pyth) · deadline Sep 25 2026

## The 10-second pitch

OPENAI pre-IPO token trades at **+53% above its issuer mark**. No wallet shows it.
FairBuy shows it, refuses the market-buy, and logs the $350 you didn't lose —
with the decision math and (for fills) a Solana Explorer link to prove it.

## How it works

```
PreStocks marks API ─┐
Pyth feed registry ──┼─▶ policy engine (code, not prompts) ─▶ BLOCK / Fair-Limit / TWAP-at-fair ─▶ Jupiter ─▶ wallet signs ─▶ Explorer receipt
Yahoo underlying ────┤         ▲                                          ▲
Nansen TGM flows ────┘         │                                          │
TypeSafe Jev verdict ──────────┘                          Overpay Ledger (learns)
```

- **Pre-IPO board (8 tokens):** live `markPrice` vs DEX price → premium badge. Cached-mode banner when the API flakes; market-buys hard-disabled in cached mode.
- **Guarded Buy:** USDC → token via Jupiter. Policy: premium vs your band (default +10%, auto-tightenable), quote impact, divergence. BLOCK (>2× band), Fair-Limit, TWAP-at-fair (per-slice re-check).
- **Listed leg (NVDAx):** underlying reference + Pyth registry session (open/closed) + onchain probe + Nansen sharp-vs-crowd divergence.
- **Typed verdict:** deterministic policy owns the decision; TypeSafe `jev-latest` adds `Choice{buy_now, limit_at_fair, wait_for_convergence, skip_thin}` + chase-risk. Offline → deterministic fallback. Key never leaves the server.
- **Overpay Ledger:** every attempt (blocks included) with regime context; deterministic autopsy; one-click band tightening; CSV export.

## What it is NOT (deliberate non-goals)

No custom Anchor program (zero audit surface in 3 days), no Tessera/Clawpump in-submission
(PreStocks exclusivity), no true onchain limit orders (Fair-Limit = re-checked conditional fill),
no raw Nansen Smart Money display (ToS-prohibited — TGM aggregates only, transformed, attributed).

## Run it

```bash
pnpm install
cp .env.local.example .env.local   # fill NANSEN_API_KEY, TYPESAFE_API_KEY
pnpm dev                            # http://localhost:3000
```

Env: `NANSEN_API_KEY`, `TYPESAFE_API_KEY` (server-only), `NEXT_PUBLIC_RPC_URL`
(defaults to mainnet-beta), `PYTH_PRO_TOKEN` (optional — flips underlying to Lazer REST).

## API / program IDs

| Dependency | Address / endpoint |
|---|---|
| PreStocks marks | `https://prestocks.com/api/prestocks` (15s TTL, pinned fallback) |
| Jupiter quote/swap | `https://lite-api.jup.ag/swap/v1/*` (no key) |
| Pyth registry (session + feed IDs) | `https://hermes.pyth.network/v2/price_feeds` (public) |
| Pyth NVDA equity feed | `b1073854ed24…` (Pro-ready; prices need Pro key) |
| Nansen TGM flow-intelligence | `POST api.nansen.ai/api/v1/tgm/flow-intelligence`, 7d, 1h TTL |
| TypeSafe System One | `POST api.typesafe.ai/v1/systemone`, model `jev-latest`, 6s timeout |
| USDC mint | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| NVDAx mint | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` |

Note (verified 2026-09-22): Hermes **price** endpoints now return 401 without Pro —
that discovery is why the underlying reference is Yahoo-backed with Lazer swap-over,
and why the Pyth bounty claim rests on registry session data + feed-ID readiness.
A free Pyth Pro key (2-min signup at pythdata.app) upgrades the listed leg to full dual-feed.

## Demo script (180s)

0:00 OPENAI +53% badge → 0:45 Market Buy **BLOCKED**, saved-$ receipt → 1:15 Fair-Limit +
Jev probabilities → 1:45 Phantom sign → Explorer link → 2:15 NVDAx sharp-vs-crowd
(top-PnL −$905k into +$10M fresh) → 2:40 ledger autopsy → 3:00 payoff.

## Security model

No custody (user signs; `skipPreflight:false`); slippage 50bps; mark labeled
issuer-reference; stale-reference hard block; fee-aware Jupiter routing;
secrets server-side only; `pnpm audit` run at ship: 23 transitive findings
(protobufjs/ws/lodash via Solana SDKs) — none in request-handling paths, no untrusted
protobuf parsing in our code; overrides deferred to avoid destabilizing the wallet
stack pre-demo; no program = no upgrade keys to lose.

## Remaining risks

Mark trust (mitigated: labeled + depth second signal) · thin-pool slippage (impact gate) ·
Yahoo underlying (swap to Lazer on key) · RPC rate limits (Helius override via env).
