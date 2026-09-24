import { Connection } from "@solana/web3.js";

export function rpcUrl(): string {
  return process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com";
}

/** Endpoints tried, in order, when a broadcast has to go out through the app
 *  rather than the wallet. Public RPCs rate-limit browsers, so we fan out. */
const ALT_RPCS = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];

let conn: Connection | null = null;
export function getConnection(): Connection {
  if (!conn) conn = new Connection(rpcUrl(), "confirmed");
  return conn;
}

/** Broadcast a signed tx, rotating endpoints if one refuses (403/429). */
export async function sendRawWithFallback(raw: Uint8Array): Promise<string> {
  const urls = Array.from(new Set([rpcUrl(), ...ALT_RPCS]));
  let lastErr: unknown;
  for (const u of urls) {
    try {
      const c = new Connection(u, "confirmed");
      return await c.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 2 });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export function describeSendError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/403|forbidden/i.test(m))
    return "RPC refused the broadcast (403). This is a provider rate-limit, not your wallet — retry, or set NEXT_PUBLIC_RPC_URL to a Helius/QuickNode key.";
  if (/429|too many requests/i.test(m))
    return "RPC rate-limited (429). Retrying usually clears it, or set NEXT_PUBLIC_RPC_URL to a keyed endpoint.";
  if (/blockhash not found|expired|invalid blockhash/i.test(m))
    return "Quote went stale before signing. Try again for a fresh quote.";
  return m.slice(0, 200);
}

export function explorerTxUrl(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=mainnet`;
}

export function explorerTokenUrl(mint: string): string {
  return `https://explorer.solana.com/address/${mint}?cluster=mainnet`;
}

export function shortAddr(a: string, n = 4): string {
  return a.length > n * 2 + 3 ? `${a.slice(0, n)}…${a.slice(-n)}` : a;
}
