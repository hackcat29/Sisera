import { type NextRequest, NextResponse } from "next/server";
import { isSameOrigin } from "../../../lib/request-origin";

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : undefined;

// Bounds what one process will log, so a broken page or a script cannot flood the journal.
const LIMIT_PER_MINUTE = 60;
let windowStart = 0;
let logged = 0;

/**
 * Receives errors that crashed part of a page in someone's browser, so they reach the server
 * logs instead of disappearing with the tab. Only the page path, message and top stack frames
 * are kept.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse(null, { status: 403 });
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    logged = 0;
  }
  if (++logged > LIMIT_PER_MINUTE) return new NextResponse(null, { status: 204 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return new NextResponse(null, { status: 204 });
  const report = body as Record<string, unknown>;
  const path = text(report.path, 200)?.split("?")[0];
  console.error(
    `[client-error] ${JSON.stringify({
      kind: text(report.kind, 20),
      path,
      name: text(report.name, 60),
      message: text(report.message, 400),
      digest: text(report.digest, 40),
      stack: text(report.stack, 800),
      agent: request.headers.get("user-agent")?.slice(0, 140),
    })}`,
  );
  return new NextResponse(null, { status: 204 });
}
