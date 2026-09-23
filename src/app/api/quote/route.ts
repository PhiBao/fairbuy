export const dynamic = "force-dynamic";

// Jupiter quote passthrough (lite, keyless). Client sends input/output mints + amount.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const inputMint = url.searchParams.get("inputMint");
  const outputMint = url.searchParams.get("outputMint");
  const amount = url.searchParams.get("amount");
  const slippageBps = url.searchParams.get("slippageBps") ?? "50";
  if (!inputMint || !outputMint || !amount) {
    return Response.json({ error: "inputMint, outputMint, amount required" }, { status: 400 });
  }
  const jup = new URL("https://lite-api.jup.ag/swap/v1/quote");
  jup.searchParams.set("inputMint", inputMint);
  jup.searchParams.set("outputMint", outputMint);
  jup.searchParams.set("amount", amount);
  jup.searchParams.set("slippageBps", slippageBps);
  jup.searchParams.set("onlyDirectRoutes", "false");
  const r = await fetch(jup.toString(), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) {
    const t = await r.text();
    return Response.json({ error: `jupiter quote ${r.status}`, detail: t.slice(0, 300) }, { status: 502 });
  }
  const q = await r.json();
  return Response.json({
    quote: q,
    priceImpactBps: q.priceImpactPct ? Math.round(Number(q.priceImpactPct) * 100) : 0,
    outAmount: q.outAmount as string,
    live: true,
  });
}
