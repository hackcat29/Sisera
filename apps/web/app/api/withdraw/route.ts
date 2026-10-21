import { type NextRequest, NextResponse } from "next/server";
import { auth } from "../../../auth";
import { isSameOrigin } from "../../../lib/request-origin";
import { serverApiUrl } from "../../../lib/server-api-url";

function failure(status: number, payload: { message?: string }) {
  const message =
    status === 401
      ? "Sign in to withdraw."
      : status === 403
        ? "This wallet is not linked to your Sisera account."
        : status === 400 || status === 422 || status === 503
          ? (payload.message ?? "Please review the withdrawal and try again.")
          : "Withdrawals are temporarily unavailable. Please try again shortly.";
  return NextResponse.json({ message }, { status });
}

/** Prepares a Solana withdrawal for the wallet to sign, or broadcasts the signed transfer. */
export async function POST(request: NextRequest) {
  if (
    !isSameOrigin(request) ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json"
  )
    return NextResponse.json({ message: "Request rejected." }, { status: 403 });
  const session = await auth();
  if (!session) return NextResponse.json({ message: "Sign in to withdraw." }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || (body.action !== "prepare" && body.action !== "execute"))
    return NextResponse.json({ message: "Invalid withdrawal request." }, { status: 400 });
  const { action, ...payload } = body as Record<string, unknown>;
  try {
    const response = await fetch(`${serverApiUrl()}/v1/solana/withdrawals/${action}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(action === "execute" ? 55000 : 20000),
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
