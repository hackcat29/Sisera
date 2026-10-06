import { type NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { isSameOrigin } from "../../../../lib/request-origin";
import { serverApiUrl } from "../../../../lib/server-api-url";

/** API areas the browser may reach through this proxy; everything else is refused. */
const ALLOWED = [
  "catalog",
  "intelligence",
  "rankings",
  "agent-market",
  "copilot",
  "policies",
  "takes",
  "arbitrage",
  "portfolio",
  "risk",
  "agents",
  "agent-orders",
  "launches",
  "clawpump",
];

async function forward(request: NextRequest, path: string[]) {
  const [area] = path;
  if (
    !area ||
    !ALLOWED.includes(area) ||
    path.some((segment) => segment === ".." || segment.includes("/"))
  )
    return NextResponse.json({ message: "Unknown endpoint." }, { status: 404 });
  const write = request.method !== "GET";
  if (
    write &&
    (!isSameOrigin(request) ||
      request.headers.get("content-type")?.split(";")[0] !== "application/json")
  )
    return NextResponse.json({ message: "Request rejected." }, { status: 403 });
  const session = await auth();
  const local =
    process.env.SISERA_LOCAL_OPERATOR_MODE === "true" && process.env.NODE_ENV !== "production";
  const headers: Record<string, string> = { accept: "application/json" };
  if (
    session &&
    !session.accessToken.startsWith("guest:") &&
    !session.accessToken.startsWith("wallet:")
  )
    headers.authorization = `Bearer ${session.accessToken}`;
  else if (local)
    Object.assign(headers, { "x-sisera-dev-role": "trader", "x-sisera-dev-subject": "web-local" });
  if (write) headers["content-type"] = "application/json";
  const target = `${serverApiUrl()}/v1/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  const long =
    path.includes("backtest") ||
    path.includes("stress") ||
    path.includes("chat") ||
    path.includes("submit") ||
    path.includes("prepare") ||
    path.includes("quote");
  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      ...(write ? { body: await request.text() } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(long ? 120_000 : 30_000),
    });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, {
      status: response.status,
      headers: {
        "cache-control": "no-store",
        ...(response.headers.get("x-request-id")
          ? { "x-request-id": response.headers.get("x-request-id") as string }
          : {}),
      },
    });
  } catch {
    return NextResponse.json(
      { message: "The Sisera service is temporarily unavailable." },
      { status: 503 },
    );
  }
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: Context) {
  return forward(request, (await context.params).path);
}
export async function POST(request: NextRequest, context: Context) {
  return forward(request, (await context.params).path);
}
export async function PUT(request: NextRequest, context: Context) {
  return forward(request, (await context.params).path);
}
