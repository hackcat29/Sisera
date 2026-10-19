import { type NextRequest, NextResponse } from "next/server";
import { auth } from "../../../auth";
import { isSameOrigin } from "../../../lib/request-origin";
import { serverApiUrl } from "../../../lib/server-api-url";

const Mint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RawAmount = /^[1-9][0-9]{0,18}$/;

function failure(status: number, payload: { message?: string }) {
  const message =
    status === 401
      ? "Sign in to swap."
      : status === 403
        ? "Link this wallet to your Sisera account before swapping."
        : status === 422 || status === 503
          ? (payload.message ?? "Please review the swap and try again.")
          : "Swaps are temporarily unavailable. Please try again shortly.";
  return NextResponse.json({ message }, { status });
}

/** Live preview of how much USDC a token amount converts to. Nothing is built or signed. */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const inputMint = params.get("inputMint") ?? "";
  const amount = params.get("amount") ?? "";
  if (!Mint.test(inputMint) || !RawAmount.test(amount))
    return NextResponse.json({ message: "Invalid swap request." }, { status: 400 });
  const session = await auth();
  const local =
    process.env.SISERA_LOCAL_OPERATOR_MODE === "true" && process.env.NODE_ENV !== "production";
  if (!session && !local)
    return NextResponse.json({ message: "Sign in to swap." }, { status: 401 });
  try {
    const response = await fetch(
      `${serverApiUrl()}/v1/solana/convert/quote?${new URLSearchParams({ inputMint, amount })}`,
      {
        headers: session
          ? { authorization: `Bearer ${session.accessToken}` }
          : { "x-sisera-dev-role": "viewer", "x-sisera-dev-subject": "web-local" },
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return failure(response.status, payload);
    return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Swap quotes are unavailable." }, { status: 503 });
  }
}

/** Prepares a swap into USDC for wallet approval, or submits the signed transaction. */
export async function POST(request: NextRequest) {
  if (
    !isSameOrigin(request) ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json"
  )
    return NextResponse.json({ message: "Request rejected." }, { status: 403 });
  const session = await auth();
  if (!session) return NextResponse.json({ message: "Sign in to swap." }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object")
    return NextResponse.json({ message: "Invalid swap request." }, { status: 400 });
  let path: string;
  let payload: Record<string, unknown>;
  if (body.action === "prepare") {
    path = "/v1/solana/convert/prepare";
    payload = {
      wallet: body.wallet,
      inputMint: body.inputMint,
      amount: body.amount,
      ...(typeof body.slippageBps === "number" ? { slippageBps: body.slippageBps } : {}),
    };
  } else if (
    body.action === "execute" &&
    typeof body.orderId === "string" &&
    /^[0-9a-f-]{36}$/i.test(body.orderId)
  ) {
    path = `/v1/solana/orders/${body.orderId}/execute`;
    payload = { signedTransaction: body.signedTransaction };
  } else return NextResponse.json({ message: "Invalid swap request." }, { status: 400 });
  try {
    const response = await fetch(`${serverApiUrl()}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(body.action === "execute" ? 55000 : 20000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return failure(response.status, result);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Swaps are temporarily unavailable." }, { status: 503 });
  }
}
