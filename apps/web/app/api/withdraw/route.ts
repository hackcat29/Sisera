import { type NextRequest, NextResponse } from "next/server";
import { auth } from "../../../auth";
import { isSameOrigin } from "../../../lib/request-origin";
import { serverApiUrl } from "../../../lib/server-api-url";

const PATHS: Record<string, string> = {
  prepare: "/v1/solana/withdrawals/prepare",
  execute: "/v1/solana/withdrawals/execute",
  "topup-prepare": "/v1/solana/gas-topup/prepare",
  "topup-execute": "/v1/solana/gas-topup/execute",
};

function failure(
  status: number,
  payload: { message?: string; error?: string; needsLamports?: string },
) {
  const message =
    status === 401
      ? "Sign in to withdraw."
      : status === 403
        ? "This wallet is not linked to your Sisera account."
        : status === 400 || status === 422 || status === 503
          ? (payload.message ?? "Please review the withdrawal and try again.")
          : "Withdrawals are temporarily unavailable. Please try again shortly.";
  // A wallet that only lacks SOL for fees can have Sisera buy some; pass that through.
  const needsSol =
    payload.error === "needs_sol"
      ? { error: payload.error, needsLamports: payload.needsLamports }
      : {};
  return NextResponse.json({ message, ...needsSol }, { status });
}

/**
 * Prepares a Solana withdrawal for the wallet to sign or broadcasts the signed transfer, and buys
 * a little SOL with USDC when the wallet has none for network fees.
 */
export async function POST(request: NextRequest) {
  if (
    !isSameOrigin(request) ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json"
  )
    return NextResponse.json({ message: "Request rejected." }, { status: 403 });
  const session = await auth();
  if (!session) return NextResponse.json({ message: "Sign in to withdraw." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const path = body && typeof body === "object" ? PATHS[String(body.action)] : undefined;
  if (!path) return NextResponse.json({ message: "Invalid withdrawal request." }, { status: 400 });
  const { action, ...payload } = body as Record<string, unknown>;
  try {
    const response = await fetch(`${serverApiUrl()}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(String(action).endsWith("execute") ? 55000 : 30000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return failure(response.status, result);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json(
      { message: "Withdrawals are temporarily unavailable." },
      { status: 503 },
    );
  }
}
