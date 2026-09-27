import { type NextRequest, NextResponse } from "next/server";
import { auth } from "../../../auth";
import { getPythReferences } from "../../../lib/api";

export async function GET(request: NextRequest) {
  const session = await auth();
  const localOperator =
    process.env.NODE_ENV !== "production" && process.env.SISERA_LOCAL_OPERATOR_MODE === "true";
  if (!session && !localOperator)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const symbols = (new URL(request.url).searchParams.get("symbols") ?? "")
    .split(",")
    .filter((symbol) => /^[A-Za-z0-9.-]{1,12}$/.test(symbol))
    .slice(0, 20);
  if (!symbols.length) return NextResponse.json({ error: "invalid_symbols" }, { status: 400 });
  try {
    const data = await getPythReferences(symbols, {
      accessToken: session?.accessToken,
      localOperator,
    });
    return NextResponse.json({ data }, { headers: { "cache-control": "private, max-age=5" } });
  } catch {
    return NextResponse.json({ error: "reference_unavailable" }, { status: 503 });
  }
}
