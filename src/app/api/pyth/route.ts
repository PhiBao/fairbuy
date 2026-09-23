export const dynamic = "force-dynamic";

// Underlying equity reference + market session state.
// Registry session (open/closed) comes from Pyth's public feed registry —
// real Pyth data, doing real work: the guard treats a closed underlying
// differently from a stale one. Reference price is Yahoo (keyless).
// No Pro key required, no Pro key referenced.
// GET /api/pyth?symbol=NVDA

const HERMES = "https://hermes.pyth.network";

interface Session {
  isOpen: boolean | null;
  nextOpen: number | null;
  nextClose: number | null;
}

let regCache: { ts: number; map: Record<string, { id: string; session: Session }> } | null = null;

async function registry(symbol: string): Promise<{ id: string; session: Session } | null> {
  const q = `Equity.US.${symbol}/USD`;
  if (regCache && Date.now() - regCache.ts < 3600_000 && regCache.map[q]) return regCache.map[q];
  try {
    const u = new URL(`${HERMES}/v2/price_feeds`);
    u.searchParams.set("query", q);
    u.searchParams.set("asset_type", "equity");
    const r = await fetch(u.toString(), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const arr = (await r.json()) as Array<{
      id: string;
      attributes?: { symbol?: string };
      market_hours?: { is_open?: boolean; next_open?: number; next_close?: number };
    }>;
    const exact = arr.find((f) => f.attributes?.symbol === q) ?? arr[0];
    if (!exact) return null;
    const entry = {
      id: exact.id,
      session: {
        isOpen: exact.market_hours?.is_open ?? null,
        nextOpen: exact.market_hours?.next_open ?? null,
        nextClose: exact.market_hours?.next_close ?? null,
      },
    };
    regCache = { ts: Date.now(), map: { ...(regCache?.map ?? {}), [q]: entry } };
    return entry;
  } catch {
    return null;
  }
}

async function yahoo(symbol: string): Promise<{ price: number; ts: number } | null> {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`, {
      headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; regularMarketTime?: number } }> };
    };
    const m = j.chart?.result?.[0]?.meta;
    if (!m?.regularMarketPrice) return null;
    return { price: m.regularMarketPrice, ts: (m.regularMarketTime ?? Date.now() / 1000) * 1000 };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol");
  if (!symbol) return Response.json({ error: "symbol required" }, { status: 400 });

  const [reg, yh] = await Promise.all([registry(symbol), yahoo(symbol)]);
  if (!yh) return Response.json({ error: "underlying unavailable", live: false }, { status: 502 });
  return Response.json({
    symbol,
    price: yh.price,
    priceTs: yh.ts,
    source: "yahoo",
    feedId: reg?.id ?? null,
    session: reg?.session ?? { isOpen: null, nextOpen: null, nextClose: null },
    live: true,
  });
}
