import { type NextRequest, NextResponse } from "next/server";
import { isSameOrigin } from "../../../lib/request-origin";

/**
 * Same-origin Solana JSON-RPC proxy for the wallet's signing screen, so the Helius key stays on
 * the server. Only read-only methods are forwarded; Sisera broadcasts transactions server-side.
 */
const ALLOWED_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getFeeForMessage",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "getSlot",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTransaction",
  "isBlockhashValid",
  "simulateTransaction",
]);
const MAX_BODY_BYTES = 256 * 1024;
const MAX_BATCH = 20;

function upstreamUrl() {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  if (process.env.HELIUS_API_KEY)
    return `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  return null;
}

const rpcError = (id: unknown, message: string, code = -32601) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request))
    return NextResponse.json(rpcError(null, "Forbidden"), { status: 403 });
  const upstream = upstreamUrl();
  if (!upstream)
    return NextResponse.json(rpcError(null, "Solana RPC is not configured", -32000), {
      status: 503,
    });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES)
    return NextResponse.json(rpcError(null, "Request too large", -32600), { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json(rpcError(null, "Parse error", -32700), { status: 400 });
  }

  const calls = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > MAX_BATCH)
    return NextResponse.json(rpcError(null, "Invalid batch", -32600), { status: 400 });
  for (const call of calls) {
    const method = (call as { method?: unknown })?.method;
    if (typeof method !== "string" || !ALLOWED_METHODS.has(method))
      return NextResponse.json(rpcError((call as { id?: unknown })?.id, "Method not allowed"), {
        status: 403,
      });
  }

  try {
    const response = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(rpcError(null, "Solana RPC unavailable", -32000), { status: 502 });
  }
}
