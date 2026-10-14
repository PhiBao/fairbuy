// Null-safe number formatting.
//
// Why this exists: a single missing mark on the upstream feed produced NaN in
// the marks route, and JSON.stringify(NaN) becomes null on the wire, so
// `null.toFixed()` white-screened the board. Every number that reaches the DOM
// now goes through here.

export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Fixed-decimal number, or an em dash for anything non-finite. */
export function num(v: unknown, digits = 2, fallback = "—"): string {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}

/** Basis points -> signed percentage, e.g. 5364 -> "+53.6%". */
export function bps(v: unknown, digits = 1, fallback = "—"): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  const pct = n / 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)}%`;
}

/** USD amount shortened for dense cards. */
export function usd(v: unknown, fallback = "—"): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "+";
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(0)}k`;
  return `${sign}$${a.toFixed(0)}`;
}
