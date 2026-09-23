// Token registry. PreStocks mints + marks API verified live 2026-09-22.
// xStocks majors resolve via Jupiter search at runtime; NVDAx pinned (verified via Jupiter).

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type StockKind = "preipo" | "listed";

export interface StockToken {
  symbol: string;
  name: string;
  kind: StockKind;
  mint: string;
  decimals: number;
  image?: string;
  /** Pyth query strings for dual-feed lookup (listed only) */
  pythEquityQuery?: string;
  pythCryptoQuery?: string;
}

export const PRESTOCKS: StockToken[] = [
  { symbol: "ANDURIL", name: "Anduril PreStocks", kind: "preipo", mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB", decimals: 6, image: "https://www.prestocks.com/logos/anduril.png" },
  { symbol: "ANTHROPIC", name: "Anthropic PreStocks", kind: "preipo", mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", decimals: 6, image: "https://www.prestocks.com/logos/anthropic.png" },
  { symbol: "FIGUREAI", name: "Figure AI PreStocks", kind: "preipo", mint: "PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd", decimals: 6, image: "https://www.prestocks.com/logos/figureai.png" },
  { symbol: "KALSHI", name: "Kalshi PreStocks", kind: "preipo", mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua", decimals: 6, image: "https://www.prestocks.com/logos/kalshi.png" },
  { symbol: "NEURALINK", name: "Neuralink PreStocks", kind: "preipo", mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S", decimals: 6, image: "https://www.prestocks.com/logos/neuralink.png" },
  { symbol: "OPENAI", name: "OpenAI PreStocks", kind: "preipo", mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", decimals: 6, image: "https://www.prestocks.com/logos/openai.png" },
  { symbol: "POLYMARKET", name: "Polymarket PreStocks", kind: "preipo", mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP", decimals: 6, image: "https://www.prestocks.com/logos/polymarket.png" },
  { symbol: "SPACEX", name: "SpaceX PreStocks", kind: "preipo", mint: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh", decimals: 6, image: "https://www.prestocks.com/logos/spacex.png" },
];

/** Pinned xStock mints (verified). Others resolve via Jupiter token search at runtime. */
export const XSTOCKS_PINNED: Record<string, { mint: string; decimals: number; name: string; equity: string }> = {
  NVDAx: { mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 8, name: "NVIDIA xStock", equity: "NVDA" },
};

export const XSTOCKS_WATCH: string[] = ["NVDAx", "AAPLx", "TSLAx", "SPYx", "QQQx", "METAx", "AMZNx", "GOOGLx"];

export function allKnownTokens(): StockToken[] {
  const listed: StockToken[] = Object.entries(XSTOCKS_PINNED).map(([symbol, v]) => ({
    symbol,
    name: v.name,
    kind: "listed",
    mint: v.mint,
    decimals: v.decimals,
    pythEquityQuery: `Equity.US.${v.equity}/USD`,
    pythCryptoQuery: `Crypto.${v.equity}X/USD`,
  }));
  return [...PRESTOCKS, ...listed];
}

export function findToken(symbol: string): StockToken | undefined {
  return allKnownTokens().find((t) => t.symbol === symbol);
}
