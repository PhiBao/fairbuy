export const dynamic = "force-dynamic";

import { USDC_MINT } from "@/lib/tokens";

// Standard $100 USDC probe -> implied onchain DEX price for a mint.
// Lets the guard price the premium without depending on the execution-size quote.
// GET /api/dexprice?mint=...&decimals=8
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mint = url.searchParams.get("mint");
  const decimals = Number(url.searchParams.get("decimals") ?? "6");
  if (!mint) return Response.json({ error: "mint required" }, { status: 400 });

  const amount = 100_000000; // $100 USDC
  const jup = new URL("https://lite-api.jup.ag/swap/v1/quote");
  jup.searchParams.set("inputMint", USDC_MINT);
  jup.searchParams.set("outputMint", mint);
  jup.searchParams.set("amount", String(amount));
  jup.searchParams.set("slippageBps", "50");
  try {
    const r = await fetch(jup.toString(), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`jupiter ${r.status}`);
    const q = (await r.json()) as { outAmount?: string; priceImpactPct?: string };
    const out = Number(q.outAmount) / 10 ** decimals;
    if (!out || out <= 0) throw new Error("empty route");
    return Response.json({
      price: 100 / out,
      impactBps: q.priceImpactPct ? Math.round(Number(q.priceImpactPct) * 100) : 0,
      live: true,
    });
  } catch (e) {
    return Response.json({ error: String(e), live: false }, { status: 502 });
  }
}
