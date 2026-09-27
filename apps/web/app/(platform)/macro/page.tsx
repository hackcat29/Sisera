import { StatusBadge } from "@sisera/ui";
import { Activity, Database, Globe2, RadioTower } from "lucide-react";
import { auth } from "../../../auth";
import { PageHeader } from "../../../components/page-header";
import { getChains, getMacroRegime, getPerpetualMetrics } from "../../../lib/api";

export const dynamic = "force-dynamic";

const sources = [
  {
    name: "Federal Reserve Economic Data",
    key: "fred",
    scope: "VIX · 10-year Treasury yield · 10Y–2Y spread",
  },
  { name: "DeFiLlama", key: null, scope: "Chain TVL snapshot" },
  { name: "Venue funding feeds", key: null, scope: "Funding · open interest" },
];

export default async function MacroPage() {
  const session = await auth();
  const identity = {
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  };
  const [metrics, chains, regime] = await Promise.all([
    getPerpetualMetrics(identity).catch(() => []),
    getChains(identity).catch(() => []),
    getMacroRegime(identity).catch(() => null),
  ]);
  const freshMetrics = metrics.filter(
    (item) => Date.now() - Date.parse(item.observedAt) < 10 * 60_000,
  );
  const freshChains = chains.filter(
    (item) => Date.now() - Date.parse(item.observedAt) < 10 * 60_000,
  );
  const chainRows = [
    ...chains.slice(0, 10),
    ...chains.filter(
      (chain) =>
        chain.name.toLowerCase() === "solana" &&
        !chains.slice(0, 10).some((listed) => listed.name === chain.name),
    ),
  ];
  const funding = freshMetrics.map((item) => Number(item.fundingRate)).filter(Number.isFinite);
  const meanFunding = funding.length
    ? funding.reduce((sum, value) => sum + value, 0) / funding.length
    : null;
  const tone =
    meanFunding == null || freshChains.length === 0
      ? null
      : meanFunding > 0.00005
        ? "Crowded long"
        : meanFunding < -0.00005
          ? "Crowded short"
          : "Balanced";
  return (
    <div className="min-h-full">
      <PageHeader
        eyebrow="Cross-asset regime"
        title="Macro & chain monitor"
        description="Point-in-time macro, liquidity, derivatives, and onchain inputs with explicit source readiness and no retrospective model leakage."
        actions={
          <StatusBadge tone={freshMetrics.length ? "positive" : "warning"}>
            {freshMetrics.length ? "Derivatives feed fresh" : "Derivatives feed unavailable"}
          </StatusBadge>
        }
      />
      <div className="grid gap-4 p-4 xl:grid-cols-[1.25fr_.75fr]">
        <aside className="border border-line bg-[#091019]">
          <div className="border-b border-line px-4 py-3 text-xs font-semibold">Regime state</div>
          <div className="p-5">
            <Globe2 size={20} className="text-cyan-300" />
            <p className="mt-8 data-label">Current classification</p>
            <p className="mt-2 text-2xl font-medium text-slate-100">
              {regime ? regime.state.replace("_", " ").toUpperCase() : "Unavailable"}
            </p>
            <p className="mt-4 text-xs leading-6 text-slate-400">
              {regime?.rationale ??
                "FRED volatility and Treasury sources have not passed the five-day freshness check."}
            </p>
            {regime && (
              <div className="mt-4 space-y-2 font-mono text-[10px] text-slate-500">
                {regime.sources.map((source) => (
                  <p key={source.id}>
                    {source.id}: {source.value.toFixed(2)} · {source.asOf}
                  </p>
                ))}
                <p>20-session 10Y change: {regime.tenYearChange20d.toFixed(3)} percentage points</p>
              </div>
            )}
            <p className="mt-4 text-xs leading-6 text-slate-500">
              {tone
                ? `Derivatives positioning: ${tone.toLowerCase()} across ${funding.length} markets and ${freshChains.length} chain snapshots.`
                : "Derivatives positioning is unavailable."}
            </p>
            <div className="mt-8 grid grid-cols-2 gap-px bg-line">
              <StateCell icon={Activity} label="Rates" available={regime !== null} />
              <StateCell icon={RadioTower} label="Liquidity" available={freshChains.length > 0} />
              <StateCell icon={Database} label="Onchain" available={freshChains.length > 0} />
              <StateCell icon={Globe2} label="Derivatives" available={freshMetrics.length > 0} />
            </div>
          </div>
        </aside>
        <section className="border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-xs font-semibold">Source registry</span>
            <Database size={14} className="text-slate-600" />
          </div>
          <div className="divide-y divide-line">
            {sources.map((source) => {
              const configured =
                source.key === "fred"
                  ? regime !== null
                  : source.name === "DeFiLlama"
                    ? freshChains.length > 0
                    : freshMetrics.length > 0;
              return (
                <div
                  key={source.name}
                  className="grid gap-3 px-4 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-center"
                >
                  <div>
                    <p className="text-xs font-medium text-slate-200">{source.name}</p>
                    <p className="mt-1 text-[10px] text-slate-600">{source.scope}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-1.5 rounded-full ${configured ? "bg-emerald-400" : "bg-amber-400"}`}
                    />
                    <span className="font-mono text-[9px] uppercase tracking-wider text-slate-500">
                      {configured ? "Fresh data" : "Unavailable"}
                    </span>
                  </div>
                  <StatusBadge tone={configured ? "positive" : "warning"}>
                    {configured ? "Ready" : "No data"}
                  </StatusBadge>
                </div>
              );
            })}
          </div>
        </section>
        <section className="overflow-hidden border border-line bg-panel xl:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-xs font-semibold">Chain liquidity ranking · top 10 + Solana</span>
            <span className="data-label">DeFiLlama · TVL snapshot · USD</span>
          </div>
          {chains.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="font-mono text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Chain</th>
                    <th>TVL / USD</th>
                    <th>Gas token</th>
                    <th>Chain ID</th>
                    <th>Fetched</th>
                  </tr>
                </thead>
                <tbody>
                  {chainRows.map((chain) => (
                    <tr key={chain.name} className="border-t border-line font-mono text-slate-300">
                      <td className="px-4 py-3 font-semibold text-white">{chain.name}</td>
                      <td>
                        {new Intl.NumberFormat("en-US", {
                          notation: "compact",
                          maximumFractionDigits: 2,
                        }).format(chain.tvlUsd)}
                      </td>
                      <td>{chain.tokenSymbol ?? "—"}</td>
                      <td>{chain.chainId ?? "—"}</td>
                      <td>{new Date(chain.observedAt).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-5 text-xs text-slate-500">
              Chain TVL feed unavailable. No values are inferred.
            </p>
          )}
        </section>
        <section className="overflow-hidden border border-line bg-panel xl:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-xs font-semibold">Perpetuals liquidity & funding</span>
            <span className="data-label">Hyperliquid · public venue feed</span>
          </div>
          {metrics.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="font-mono text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Market</th>
                    <th>Mark / USDC</th>
                    <th>Oracle</th>
                    <th>Funding / 1h</th>
                    <th>Open interest · base</th>
                    <th>24h notional / USDC</th>
                    <th>Observed</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((item) => (
                    <tr key={item.symbol} className="border-t border-line font-mono text-slate-300">
                      <td className="px-4 py-3 font-semibold text-white">{item.symbol}</td>
                      <td>{Number(item.markPrice).toLocaleString()}</td>
                      <td>{item.oraclePrice ? Number(item.oraclePrice).toLocaleString() : "—"}</td>
                      <td
                        className={
                          Number(item.fundingRate) >= 0 ? "text-emerald-300" : "text-rose-300"
                        }
                      >
                        {item.fundingRate ? `${(Number(item.fundingRate) * 100).toFixed(4)}%` : "—"}
                      </td>
                      <td>
                        {item.openInterestBase
                          ? Number(item.openInterestBase).toLocaleString()
                          : "—"}
                      </td>
                      <td>
                        {item.volume24hUsd
                          ? Number(item.volume24hUsd).toLocaleString(undefined, {
                              notation: "compact",
                              maximumFractionDigits: 2,
                            })
                          : "—"}
                      </td>
                      <td>{new Date(item.observedAt).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-5 text-xs text-slate-500">
              The public derivatives feed is unavailable. No funding or open-interest values are
              inferred.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function StateCell({
  icon: Icon,
  label,
  available,
}: { icon: typeof Activity; label: string; available: boolean }) {
  return (
    <div className="bg-panel p-3">
      <Icon size={12} className="text-slate-700" />
      <p className="mt-3 data-label">{label}</p>
      <p className={`mt-1 text-[9px] ${available ? "text-emerald-300" : "text-slate-700"}`}>
        {available ? "Fresh observation" : "No observation"}
      </p>
    </div>
  );
}
