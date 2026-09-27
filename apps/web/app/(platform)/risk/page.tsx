import { StatusBadge } from "@sisera/ui";
import { Activity, Ban, CircleGauge, ShieldAlert, Siren, Waves } from "lucide-react";
import { Suspense } from "react";
import { auth } from "../../../auth";
import { EmptyState } from "../../../components/empty-state";
import { PageHeader } from "../../../components/page-header";
import { PortfolioPrivyWallet } from "../../../components/portfolio-privy-wallet";
import { accountErrorMessage, getPublicPerpAccount, getSolanaWallet } from "../../../lib/api";

export const dynamic = "force-dynamic";

const limits = [
  "Order notional",
  "Position concentration",
  "Gross exposure",
  "Net exposure",
  "Daily loss",
  "Portfolio leverage",
];
const scenarios = [
  { name: "Crypto liquidity shock", detail: "BTC −12% · ETH −16% · depth −70%" },
  { name: "Stablecoin dislocation", detail: "USDC −8% · spreads ×5" },
  { name: "Macro volatility spike", detail: "Rates +75bp · vol ×2 · USD +3%" },
];

export default async function RiskPage({
  searchParams,
}: { searchParams: Promise<{ address?: string; solana?: string }> }) {
  const parameters = await searchParams;
  const address = parameters.address?.trim() ?? "";
  const solanaAddress = parameters.solana?.trim() ?? "";
  const session = await auth();
  const identity = {
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  };
  const [observedResult, solanaResult] = await Promise.all([
    (/^0x[a-fA-F0-9]{40}$/.test(address)
      ? getPublicPerpAccount(address, identity)
      : Promise.resolve(null)
    ).then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null, error }),
    ),
    (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solanaAddress)
      ? getSolanaWallet(solanaAddress, identity)
      : Promise.resolve(null)
    ).then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null, error }),
    ),
  ]);
  const observed = observedResult.value;
  const solana = solanaResult.value;
  const accountValue = Number(observed?.accountValue ?? 0);
  const exposureMultiple =
    accountValue > 0 ? Math.abs(Number(observed?.notionalExposure)) / accountValue : null;
  const marginUtilization =
    accountValue > 0 ? (Number(observed?.marginUsed) / accountValue) * 100 : null;
  return (
    <div className="min-h-full">
      <Suspense fallback={null}>
        <PortfolioPrivyWallet />
      </Suspense>
      <PageHeader
        eyebrow="Deterministic Risk Engine"
        title="Risk command center"
        description="Inspect observed exposure and why execution is gated. Reconciled portfolio records are required before full limits and stress controls can operate."
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge tone="warning">Partial order limits</StatusBadge>
          </div>
        }
      />
      <div className="grid gap-px border-b border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Risk state",
            value: "Execution gated",
            tone: "text-amber-300",
            icon: CircleGauge,
          },
          { label: "Breaches", value: "—", tone: "text-slate-600", icon: ShieldAlert },
          { label: "Blocked orders", value: "—", tone: "text-slate-600", icon: Ban },
          { label: "Quote freshness", value: "Live only", tone: "text-cyan-300", icon: Activity },
        ].map((item) => (
          <div key={item.label} className="bg-panel p-5">
            <div className="flex items-center justify-between">
              <p className="data-label">{item.label}</p>
              <item.icon size={13} className="text-slate-700" />
            </div>
            <p className={`data-value mt-4 text-xl ${item.tone}`}>{item.value}</p>
          </div>
        ))}
      </div>
      <section className="m-4 rounded-lg border border-amber-400/20 bg-amber-400/[.05] p-5 text-xs leading-6 text-slate-300 md:m-6">
        <h2 className="text-sm font-semibold text-white">Before live execution</h2>
        <p className="mt-2">
          Verify wallet ownership, establish a reconciled portfolio ledger, validate fresh venue
          quotes, and enforce order and exposure limits. The current wallet views are public
          observations and do not satisfy these gates.
        </p>
      </section>
      <section className="mx-4 border border-line bg-panel p-5 md:mx-6">
        <h2 className="text-sm font-semibold text-white">Solana wallet risk observation</h2>
        <p className="mt-2 text-xs text-slate-400">
          Balance and token concentration are observed from chain state. USD exposure requires
          verified token prices.
        </p>
        <form action="/risk" className="mt-3 flex gap-2">
          <input
            name="solana"
            defaultValue={solanaAddress}
            placeholder="Solana wallet address"
            className="min-w-0 flex-1 rounded border border-line bg-ink p-2 font-mono text-xs"
          />
          <button
            type="submit"
            className="rounded border border-cyan-400/30 px-3 text-xs text-cyan-300"
          >
            Inspect
          </button>
        </form>
        {solana && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <p className="data-label">Native balance</p>
              <p className="mt-1 font-mono text-lg text-white">
                {(Number(solana.solLamports) / 1e9).toFixed(4)} SOL
              </p>
            </div>
            <div>
              <p className="data-label">Token mints held</p>
              <p className="mt-1 font-mono text-lg text-white">{solana.holdings.length}</p>
            </div>
            <div>
              <p className="data-label">Source</p>
              <p className="mt-1 font-mono text-xs text-white">{solana.source}</p>
            </div>
          </div>
        )}
        {solanaAddress && !solana && (
          <p className="mt-3 text-xs text-amber-300">
            {solanaResult.error
              ? accountErrorMessage(solanaResult.error)
              : "Enter a valid Solana address to inspect balances."}
          </p>
        )}
      </section>
      <section className="m-4 border border-line bg-panel p-5 md:m-6">
        <p className="eyebrow">Observed exposure · research only</p>
        <h2 className="mt-1 text-base font-semibold text-slate-100">
          Hyperliquid public wallet exposure
        </h2>
        <p className="mt-2 text-xs text-slate-400">
          Enter a public address to inspect its reported perp exposure. These figures do not
          activate risk limits or trading.
        </p>
        <form action="/risk" className="mt-4 flex flex-wrap gap-2">
          <input
            name="address"
            defaultValue={address}
            aria-label="Hyperliquid wallet address"
            placeholder="0x… public wallet address"
            className="min-w-64 flex-1 rounded border border-line bg-[#0f1a22] px-3 py-2 font-mono text-xs text-slate-100"
          />
          <button
            type="submit"
            className="rounded border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-xs font-semibold text-cyan-300"
          >
            Observe risk
          </button>
        </form>
        {observed && (
          <div className="mt-4 grid gap-px bg-line sm:grid-cols-3">
            {[
              ["Account value", `$${Number(observed.accountValue).toLocaleString()}`],
              [
                "Notional / equity",
                exposureMultiple == null ? "—" : `${exposureMultiple.toFixed(2)}×`,
              ],
              [
                "Margin / equity",
                marginUtilization == null ? "—" : `${marginUtilization.toFixed(1)}%`,
              ],
            ].map(([label, value]) => (
              <div key={label} className="bg-[#101b23] p-4">
                <p className="data-label">{label}</p>
                <p className="mt-2 font-mono text-lg text-white">{value}</p>
              </div>
            ))}
          </div>
        )}
        {observed && (
          <p className="mt-3 font-mono text-[10px] text-slate-500">
            {observed.source} · fetched {new Date(observed.fetchedAt).toLocaleTimeString()} · public
            read-only data
          </p>
        )}
        {address && !observed && (
          <p className="mt-3 text-xs text-amber-300">
            {observedResult.error
              ? accountErrorMessage(observedResult.error)
              : "Enter a valid 0x address to inspect exposure."}
          </p>
        )}
      </section>
      <div className="grid gap-4 p-4 xl:grid-cols-[1.15fr_.85fr]">
        <section className="border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-xs font-semibold">Mandate utilization</span>
            <span className="data-label">Portfolio required</span>
          </div>
          <div className="divide-y divide-line">
            {limits.map((limit) => (
              <div
                key={limit}
                className="grid grid-cols-[1fr_110px_90px] items-center gap-4 px-4 py-4"
              >
                <div>
                  <p className="text-[11px] text-slate-300">{limit}</p>
                  <div className="mt-2 h-1 max-w-sm bg-slate-800" />
                </div>
                <span className="data-value text-right text-[10px] text-slate-600">— used</span>
                <span className="data-value text-right text-[10px] text-slate-700">/ — limit</span>
              </div>
            ))}
          </div>
        </section>
        <section className="border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-xs font-semibold">Stress library</span>
            <Waves size={13} className="text-slate-600" />
          </div>
          <div className="divide-y divide-line">
            {scenarios.map((scenario) => (
              <div
                key={scenario.name}
                className="flex items-center justify-between gap-4 px-4 py-4"
              >
                <div>
                  <p className="text-[11px] font-medium text-slate-300">{scenario.name}</p>
                  <p className="mt-1 font-mono text-[9px] text-slate-600">{scenario.detail}</p>
                </div>
                <button
                  type="button"
                  disabled
                  className="h-7 border border-line px-3 text-[9px] text-slate-700"
                >
                  Run
                </button>
              </div>
            ))}
          </div>
          <div className="border-t border-line p-3">
            <EmptyState
              icon={ShieldAlert}
              title="Portfolio state required"
              copy="Scenario loss and margin projections run only against a reconciled snapshot."
              code="STRESS / BLOCKED"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
