export const dynamic = "force-dynamic";

import { premiumBps } from "@/lib/policy";

interface MarkRow {
  symbol: string;
  mint: string;
  markPrice: number;
  tokenPrice: number;
  premiumBps: number;
  supply: number;
  image: string;
}

const TTL_MS = 15_000;
let cache: { ts: number; rows: MarkRow[] } | null = null;

// Verified snapshot 2026-09-22 — served only when live API is unreachable.
const PINNED: MarkRow[] = [
  { symbol: "ANDURIL", mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB", markPrice: 152.47, tokenPrice: 149.85, premiumBps: -170, supply: 11805.84, image: "https://www.prestocks.com/logos/anduril.png" },
  { symbol: "ANTHROPIC", mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", markPrice: 1050.42, tokenPrice: 1037.42, premiumBps: -124, supply: 7381.83, image: "https://www.prestocks.com/logos/anthropic.png" },
  { symbol: "FIGUREAI", mint: "PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd", markPrice: 181.9, tokenPrice: 175.63, premiumBps: -344, supply: 3012.86, image: "https://www.prestocks.com/logos/figureai.png" },
  { symbol: "KALSHI", mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua", markPrice: 886.7, tokenPrice: 886.97, premiumBps: 3, supply: 904.89, image: "https://www.prestocks.com/logos/kalshi.png" },
  { symbol: "NEURALINK", mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S", markPrice: 338.64, tokenPrice: 441.35, premiumBps: 30330, supply: 2595.31, image: "https://www.prestocks.com/logos/neuralink.png" },
  { symbol: "OPENAI", mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", markPrice: 1005.72, tokenPrice: 1545.17, premiumBps: 53640, supply: 2826.4, image: "https://www.prestocks.com/logos/openai.png" },
  { symbol: "POLYMARKET", mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP", markPrice: 144.11, tokenPrice: 142.4, premiumBps: -119, supply: 4817.0, image: "https://www.prestocks.com/logos/polymarket.png" },
  { symbol: "SPACEX", mint: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh", markPrice: 153.21, tokenPrice: 113.35, premiumBps: -26020, supply: 43712.53, image: "https://www.prestocks.com/logos/spacex.png" },
];

export async function GET() {
  if (cache && Date.now() - cache.ts < TTL_MS) {
    return Response.json({ rows: cache.rows, live: true, cachedAt: cache.ts });
  }
  try {
    const r = await fetch("https://prestocks.com/api/prestocks", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`prestocks ${r.status}`);
    const raw = (await r.json()) as Array<{
      symbol: string;
      contract_address: string;
      markPrice: number;
      tokenPrice: number;
      supply: number;
      image?: string;
    }>;
    const rows: MarkRow[] = raw.map((t) => ({
      symbol: t.symbol,
      mint: t.contract_address,
      markPrice: t.markPrice,
      tokenPrice: t.tokenPrice,
      premiumBps: Math.round(premiumBps(t.tokenPrice, t.markPrice)),
      supply: t.supply,
      image: t.image ?? "",
    }));
    cache = { ts: Date.now(), rows };
    return Response.json({ rows, live: true, cachedAt: cache.ts });
  } catch {
    const rows = cache?.rows ?? PINNED;
    return Response.json({
      rows,
      live: false,
      cachedAt: cache?.ts ?? null,
      warning: "PreStocks API unreachable — pinned snapshot. Execution of market-buys is disabled in cached mode.",
    });
  }
}
