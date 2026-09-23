import { Connection } from "@solana/web3.js";

export function rpcUrl(): string {
  return process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com";
}

let conn: Connection | null = null;
export function getConnection(): Connection {
  if (!conn) conn = new Connection(rpcUrl(), "confirmed");
  return conn;
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
