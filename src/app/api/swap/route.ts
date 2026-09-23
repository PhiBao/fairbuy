export const dynamic = "force-dynamic";

// Jupiter swap-transaction builder. Client signs with the wallet; we never custody.
export async function POST(req: Request) {
  const body = (await req.json()) as {
    quoteResponse?: unknown;
    userPublicKey?: string;
  };
  if (!body.quoteResponse || !body.userPublicKey) {
    return Response.json({ error: "quoteResponse + userPublicKey required" }, { status: 400 });
  }
  const r = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      quoteResponse: body.quoteResponse,
      userPublicKey: body.userPublicKey,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const t = await r.text();
    return Response.json({ error: `jupiter swap ${r.status}`, detail: t.slice(0, 300) }, { status: 502 });
  }
  const s = await r.json();
  return Response.json({ swapTransaction: s.swapTransaction as string, live: true });
}
