import { type NextRequest, NextResponse } from "next/server";
import { auth } from "../../../auth";
import { isSameOrigin } from "../../../lib/request-origin";
import { serverApiUrl } from "../../../lib/server-api-url";

export async function POST(request: NextRequest) {
  if (
    !isSameOrigin(request) ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json"
  )
    return NextResponse.json({ message: "Request rejected." }, { status: 403 });

  const session = await auth();
  if (
    !session ||
    session.accessToken.startsWith("guest:") ||
    session.accessToken.startsWith("wallet:")
  )
    return NextResponse.json(
      { message: "Sign in with your account to claim prediction payouts." },
      { status: 401 },
    );

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object")
    return NextResponse.json({ message: "Invalid request payload." }, { status: 400 });

  const marketId = body.marketId;
  if (!marketId || typeof marketId !== "string")
    return NextResponse.json({ message: "Market ID is required." }, { status: 400 });

  const path =
    body.action === "prepare"
      ? `/v1/prediction-markets/${encodeURIComponent(marketId)}/claim/prepare`
      : body.action === "execute"
        ? `/v1/prediction-markets/${encodeURIComponent(marketId)}/claim/execute`
        : null;

  if (!path) return NextResponse.json({ message: "Invalid claim action." }, { status: 400 });

  try {
    const response = await fetch(`${serverApiUrl()}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(body.action === "execute" ? 55_000 : 20_000),
    });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Claim service is temporarily unavailable. Check your wallet before retrying.",
      },
      { status: 503 },
    );
  }
}
