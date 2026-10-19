import { type NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { isSameOrigin } from "../../../../lib/request-origin";
import { serverApiUrl } from "../../../../lib/server-api-url";

/** Quotes a Relay swap of any EVM token into USDC; signing happens in the user's wallet. */
export async function POST(request: NextRequest) {
  if (
    !isSameOrigin(request) ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json"
  )
    return NextResponse.json({ message: "Request rejected." }, { status: 403 });
  const session = await auth();
  if (!session) return NextResponse.json({ message: "Sign in to swap." }, { status: 401 });
  try {
    const response = await fetch(`${serverApiUrl()}/v1/bridge/swap-quote`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(await request.json()),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      return NextResponse.json(
        {
          message:
            response.status === 403
              ? "Link this wallet to your Sisera account before swapping."
              : (payload.message ?? "Swap quotes are temporarily unavailable."),
        },
        { status: response.status },
      );
    return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Swap quotes are unavailable." }, { status: 503 });
  }
}
