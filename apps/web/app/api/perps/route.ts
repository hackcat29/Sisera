import { type NextRequest, NextResponse } from "next/server";
import { auth } from "../../../auth";
import { isSameOrigin } from "../../../lib/request-origin";
import { serverApiUrl } from "../../../lib/server-api-url";

const Uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hyperliquid perps: prepare and submit orders, and deposit Solana USDC as margin. */
export async function POST(request: NextRequest) {
  if (
    !isSameOrigin(request) ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json"
  )
    return NextResponse.json({ message: "Request rejected." }, { status: 403 });
  const session = await auth();
  if (!session) return NextResponse.json({ message: "Sign in to trade." }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object")
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  const { action, orderId, ...payload } = body as { action?: string; orderId?: unknown };
  let path: string;
  if (action === "prepare") path = "/v1/hyperliquid/orders/prepare";
  else if (action === "execute" && typeof orderId === "string" && Uuid.test(orderId))
    path = `/v1/hyperliquid/orders/${orderId}/execute`;
  else if (action === "deposit-prepare") path = "/v1/hyperliquid/deposits/prepare";
  else if (action === "deposit-execute") path = "/v1/hyperliquid/deposits/execute";
  else return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  try {
    const response = await fetch(`${serverApiUrl()}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(
        action === "execute" || action === "deposit-execute" ? 55000 : 20000,
      ),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        response.status === 401
          ? "Sign in to trade."
          : response.status === 403 && result.error === "wallet_not_linked"
            ? "Link this wallet to your Sisera account before trading."
            : response.status === 400
              ? "Please check the order and try again."
              : (result.message ?? "Trading is temporarily unavailable. Please try again shortly.");
      // Codes such as builder_fee_approval_required tell the client which approval to request.
      return NextResponse.json(
        {
          message,
          ...(typeof result.error === "string" ? { error: result.error } : {}),
          ...(typeof result.builder === "string" ? { builder: result.builder } : {}),
          ...(typeof result.maxFeeRate === "string" ? { maxFeeRate: result.maxFeeRate } : {}),
        },
        { status: response.status },
      );
    }
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Trading is temporarily unavailable." }, { status: 503 });
  }
}
