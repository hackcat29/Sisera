import { type NextRequest, NextResponse } from "next/server";
import { auth } from "../../../auth";
import { serverApiUrl } from "../../../lib/server-api-url";

const Address = /^0x[a-fA-F0-9]{40}$/;

/** EVM wallet balances across swap chains, or one ERC-20 looked up by contract address. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const address = params.get("address") ?? "";
  const token = params.get("token");
  const chainId = params.get("chainId");
  if (!Address.test(address) || (token && (!Address.test(token) || !/^\d+$/.test(chainId ?? ""))))
    return NextResponse.json({ message: "Invalid wallet request." }, { status: 400 });
  const session = await auth();
  if (!session) return NextResponse.json({ message: "Sign in to view balances." }, { status: 401 });
  const path = token
    ? `/v1/wallets/evm/${address}/token?${new URLSearchParams({ chainId: chainId ?? "", token })}`
    : `/v1/wallets/evm/${address}/assets`;
  try {
    const response = await fetch(`${serverApiUrl()}${path}`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      return NextResponse.json(
        { message: payload.message ?? "EVM wallet balances are unavailable." },
        { status: response.status },
      );
    return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "EVM wallet balances are unavailable." }, { status: 503 });
  }
}
