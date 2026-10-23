import { type NextRequest, NextResponse } from "next/server";
import { auth } from "../../../auth";
import { isSameOrigin } from "../../../lib/request-origin";
import { serverApiUrl } from "../../../lib/server-api-url";

export async function GET(request: NextRequest) {
  if (!isSameOrigin(request))
    return NextResponse.json({ message: "Request rejected." }, { status: 403 });

  const session = await auth();
  if (
    !session ||
    session.accessToken.startsWith("guest:") ||
    session.accessToken.startsWith("wallet:")
  )
    return NextResponse.json({ data: [] });

  const wallet = request.nextUrl.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ data: [] });

  try {
    const response = await fetch(
      `${serverApiUrl()}/v1/prediction-positions?wallet=${encodeURIComponent(wallet)}`,
      {
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return NextResponse.json({ data: [] });
    const payload = await response.json();
    return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ data: [] });
  }
}
