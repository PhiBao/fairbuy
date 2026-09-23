export const dynamic = "force-dynamic";

// Nansen Token God Mode flow-intelligence proxy (redistribution-ALLOWED endpoints
// only: tgm/flows family with attribution). Smart Money RAW endpoints
// (smart-money/dex-trades, smart-money/holdings) are prohibited from display
// and are never called here. Cached server-side: 1 credit per token per hour.
// GET /api/flows?mint=<solana mint>  (listed xStocks only)

const TTL_MS = 3600_000;
const cache = new Map<string, { ts: number; data: FlowSnapshot }>();

export interface FlowSnapshot {
  mint: string;
  smartTraderNetFlowUsd: number | null;
  topPnlNetFlowUsd: number | null;
  whaleNetFlowUsd: number | null;
  freshNetFlowUsd: number | null;
  smartTraderWallets: number;
  topPnlWallets: number;
  whaleWallets: number;
  updatedAt: number;
  live: boolean;
  attribution: string;
}

const EMPTY: Omit<FlowSnapshot, "mint" | "updatedAt" | "live"> = {
  smartTraderNetFlowUsd: null,
  topPnlNetFlowUsd: null,
  whaleNetFlowUsd: null,
  freshNetFlowUsd: null,
  smartTraderWallets: 0,
  topPnlWallets: 0,
  whaleWallets: 0,
  attribution: "Flows by Nansen API",
};

export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint");
  if (!mint) return Response.json({ error: "mint required" }, { status: 400 });
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.ts < TTL_MS) return Response.json(hit.data);
  const key = process.env.NANSEN_API_KEY;
  if (!key) return Response.json({ ...EMPTY, mint, updatedAt: Date.now(), live: false });
  try {
    const r = await fetch("https://api.nansen.ai/api/v1/tgm/flow-intelligence", {
      method: "POST",
      headers: { "content-type": "application/json", apikey: key },
      body: JSON.stringify({ chain: "solana", token_address: mint, timeframe: "7d" }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(`nansen ${r.status}`);
    const j = (await r.json()) as { data?: Array<Record<string, number | null>> };
    const d = j.data?.[0] ?? {};
    const snap: FlowSnapshot = {
      mint,
      smartTraderNetFlowUsd: (d.smart_trader_net_flow_usd as number) ?? null,
      topPnlNetFlowUsd: (d.top_pnl_net_flow_usd as number) ?? null,
      whaleNetFlowUsd: (d.whale_net_flow_usd as number) ?? null,
      freshNetFlowUsd: (d.fresh_wallets_net_flow_usd as number) ?? null,
      smartTraderWallets: (d.smart_trader_wallet_count as number) ?? 0,
      topPnlWallets: (d.top_pnl_wallet_count as number) ?? 0,
      whaleWallets: (d.whale_wallet_count as number) ?? 0,
      updatedAt: Date.now(),
      live: true,
      attribution: "Flows by Nansen API",
    };
    cache.set(mint, { ts: Date.now(), data: snap });
    return Response.json(snap);
  } catch {
    return Response.json({ ...EMPTY, mint, updatedAt: Date.now(), live: false });
  }
}
