import Link from "next/link";
import { auth } from "../../../auth";
import { PageHeader } from "../../../components/page-header";
import { accountErrorMessage, getLeaderboard } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const session = await auth();
  const response = await getLeaderboard({
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  }).then(
    (value) => ({ value, error: null as unknown }),
    (error: unknown) => ({ value: null, error }),
  );
  const result = response.value;
  return (
    <div>
      <PageHeader
        eyebrow="Paper performance"
        title="Leaderboard"
        description="Opt-in pseudonymous paper rankings across priced Solana stock, Binance spot, and Hyperliquid perp accounts. Live venue and prediction P&L are not yet included."
      />
      <div className="p-4">
        <section className="border border-line bg-panel">
          <div className="flex justify-between border-b border-line px-4 py-3 text-xs">
            <span>{result?.scope ?? "Ledger unavailable"}</span>
            <span>{result?.data.length ?? 0} ranked</span>
          </div>
          {response.error ? (
            <p className="p-5 text-xs text-amber-200">{accountErrorMessage(response.error)}</p>
          ) : result?.data.length ? (
            <div className="divide-y divide-line">
              {result.data.map((row, index) => (
                <div
                  key={row.name}
                  className="grid grid-cols-[50px_1fr_120px_100px] items-center gap-2 px-4 py-3 text-xs"
                >
                  <span className="font-mono text-slate-500">{index + 1}</span>
                  <span className="text-white">{row.name}</span>
                  <span
                    className={`text-right font-mono ${row.pnlUsd >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                  >
                    ${row.pnlUsd.toFixed(2)}
                  </span>
                  <span className="text-right font-mono text-slate-300">
                    {row.returnPct.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 text-xs text-slate-400">
              <p className="font-semibold text-slate-200">No eligible accounts to rank yet</p>
              <p className="mt-2 max-w-xl leading-5">
                A paper account appears only after its holdings can be priced and its owner opts in.
                Unpriced balances are excluded rather than estimated.
              </p>
              <Link
                href="/settings"
                className="mt-4 inline-block rounded border border-cyan-400/30 px-3 py-2 text-cyan-300 hover:text-white"
              >
                Review leaderboard preference →
              </Link>
            </div>
          )}
          {result && (
            <p className="border-t border-line px-4 py-3 text-[10px] text-slate-500">
              ${result.baselineUsd.toLocaleString()} initial capital per paper ledger ·{" "}
              {result.skippedUnpriced} accounts excluded because a holding lacks a current mark.
              Pseudonymous display names.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
