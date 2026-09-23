export const dynamic = "force-dynamic";

// Underlying equity reference + session state + (with Pro key) true dual-feed.
//
// Source priority:
//   1. Pyth Lazer REST (server-side, Bearer PRO key): Equity.US.* + Crypto.*X/USD
//      in one call — the genuine dual-feed. Feed IDs verified via Pyth symbology.
//   2. Fallback: Yahoo underlying + Pyth public registry session.
// Session open/closed comes from Pyth's public feed registry (Hermes search
// metadata) — Pyth data doing real work: the guard treats a closed underlying
// differently from a stale one.
// GET /api/pyth?symbol=NVDA

const HERMES = "https://hermes.pyth.network";
const LAZER = "https://pyth-lazer.dourolabs.app";

// Verified via Pyth symbology (MCP get_symbols), 2026-09-22.
const FEEDS: Record<string, { equity: string; crypto: string; eqId: number; crId: number }> = {
  NVDA: { equity: "Equity.US.NVDA/USD", crypto: "Crypto.NVDAX/USD", eqId: 1314, crId: 1833 },
};

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

interface LazerDual {
  equityPrice: number;
  equityTs: number;
  cryptoPrice: number;
  cryptoTs: number;
}

// Defensive parse: response shape varies by format; walk plausible layouts.
function parseLazer(j: unknown, eqId: number, crId: number): LazerDual | null {
  const feeds: Array<Record<string, unknown>> = [];
  const root = j as Record<string, unknown>;
  const cands = [root?.["data"], root?.["parsed"], root];
  for (const c of cands) {
    const o = c as Record<string, unknown>;
    const pf = o?.["priceFeeds"] ?? o?.["price_feeds"];
    if (Array.isArray(pf)) {
      for (const f of pf) feeds.push(f as Record<string, unknown>);
    }
  }
  const byId = new Map<number, Record<string, unknown>>();
  for (const f of feeds) {
    const id = Number(f["priceFeedId"] ?? f["price_feed_id"]);
    if (Number.isFinite(id)) byId.set(id, f);
  }
  const num = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const p = num(o["price"]);
      const e = num(o["exponent"] ?? o["expo"]);
      if (p !== null && e !== null) return p * 10 ** e;
      if (p !== null) return p;
    }
    return null;
  };
  const get = (id: number): { price: number; ts: number } | null => {
    const f = byId.get(id);
    if (!f) return null;
    const price = num(f["price"]);
    const tsRaw = f["feedUpdateTimestamp"] ?? f["timestampUs"] ?? f["timestamp"];
    const ts = num(tsRaw);
    if (price === null) return null;
    // timestamps may be micros; normalize to ms
    const tsMs = ts !== null ? (ts > 1e14 ? Math.round(ts / 1000) : ts > 1e11 ? ts : ts * 1000) : Date.now();
    return { price, ts: tsMs };
  };
  const eq = get(eqId);
  const cr = get(crId);
  if (!eq || !cr) return null;
  return { equityPrice: eq.price, equityTs: eq.ts, cryptoPrice: cr.price, cryptoTs: cr.ts };
}

async function lazer(symbol: string): Promise<LazerDual | null> {
  const key = process.env.PYTH_PRO_TOKEN || process.env.PYTH_API_KEY;
  const cfg = FEEDS[symbol];
  if (!key || !cfg) return null;
  try {
    const r = await fetch(`${LAZER}/v1/latest_price`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        channel: "fixed_rate@200ms",
        formats: ["json"],
        parsed: true,
        properties: ["price", "feedUpdateTimestamp"],
        priceFeedIds: [cfg.eqId, cfg.crId],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    return parseLazer(await r.json(), cfg.eqId, cfg.crId);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol");
  if (!symbol) return Response.json({ error: "symbol required" }, { status: 400 });

  const [reg, dual, yh] = await Promise.all([registry(symbol), lazer(symbol), yahoo(symbol)]);

  if (dual) {
    const divergenceBps =
      dual.equityPrice > 0
        ? Math.round((Math.abs(dual.equityPrice - dual.cryptoPrice) / dual.equityPrice) * 10000)
        : null;
    return Response.json({
      symbol,
      equity: { price: dual.equityPrice, ts: dual.equityTs },
      crypto: { price: dual.cryptoPrice, ts: dual.cryptoTs },
      divergenceBps,
      price: dual.equityPrice,
      priceTs: dual.cryptoTs,
      source: "lazer",
      feedId: reg?.id ?? null,
      lazerIds: FEEDS[symbol] ? { eq: FEEDS[symbol].eqId, cr: FEEDS[symbol].crId } : null,
      session: reg?.session ?? { isOpen: null, nextOpen: null, nextClose: null },
      live: true,
    });
  }

  if (!yh) return Response.json({ error: "underlying unavailable", live: false }, { status: 502 });
  return Response.json({
    symbol,
    price: yh.price,
    priceTs: yh.ts,
    source: process.env.PYTH_PRO_TOKEN || process.env.PYTH_API_KEY ? "yahoo-pro-key-present" : "yahoo",
    feedId: reg?.id ?? null,
    session: reg?.session ?? { isOpen: null, nextOpen: null, nextClose: null },
    live: true,
  });
}
