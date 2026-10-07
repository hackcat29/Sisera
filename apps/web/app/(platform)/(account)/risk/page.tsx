import { StatusBadge } from "@sisera/ui";
import { Activity, Ban, CircleGauge, ShieldAlert, Waves } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { auth } from "../../../../auth";
import { PageHeader } from "../../../../components/page-header";
import { MandatePanel } from "../../../../components/platform/mandate-panel";
import { PortfolioPrivyWallet } from "../../../../components/portfolio-privy-wallet";
import {
  accountErrorMessage,
  getPublicPerpAccount,
  getPublicStocks,
  getReferenceMarkets,
  getSolanaWallet,
} from "../../../../lib/api";
import { signTone } from "../../../../lib/sign";
import { valueSolanaWallet } from "../../../../lib/wallet-observation";

export const metadata: Metadata = {
  title: "Risk",
  description: "Exposure, market shock tests, and the limits that protect your trades.",
};

export const dynamic = "force-dynamic";

const limits = [
  ["Stock trade size", "$500 per live order"],
  ["Price impact", "2% maximum"],
  ["Quote freshness", "15 seconds"],
  ["Wallet", "Must belong to your account"],
  ["Network fees", "At least 0.001 SOL"],
];
const scenarios = [
  {
    name: "BTC / ETH selloff",
    detail: "BTC −12% · ETH −16%",
    shock: (coin: string) => (coin === "BTC" ? -0.12 : coin === "ETH" ? -0.16 : null),
  },
  {
    name: "Broad crypto drawdown",
    detail: "All open perpetuals −20%",
    shock: (_coin: string) => -0.2,
  },
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
  const [observedResult, solanaResult, stocksResult, referencesResult] = await Promise.all([
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
    (solanaAddress ? getPublicStocks(identity) : Promise.resolve([])).catch(() => []),
    (solanaAddress ? getReferenceMarkets(["SOLUSDT"], identity) : Promise.resolve([])).catch(
      () => [],
    ),
  ]);
  const observed = observedResult.value;
  const solana = solanaResult.value;
  const walletObservation = solana
    ? valueSolanaWallet(solana, stocksResult, referencesResult)
    : null;
  const accountValue = Number(observed?.accountValue ?? 0);
  const exposureMultiple =
    accountValue > 0 ? Math.abs(Number(observed?.notionalExposure)) / accountValue : null;
  const marginUtilization =
    accountValue > 0 ? (Number(observed?.marginUsed) / accountValue) * 100 : null;
  return (
    <div className="min-h-full">
      <Suspense fallback={null}>
        <PortfolioPrivyWallet mode="linked" />
      </Suspense>
      <PageHeader
        eyebrow="Protect your portfolio"
        title="Risk overview"
        description="See your exposure, test market shocks and understand the limits that protect your trades."
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge tone="warning">Live trading safeguards</StatusBadge>
          </div>
        }
      />
      <MandatePanel />
      <div className="grid gap-px border-b border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Risk state",
            value: solana || observed ? "In view" : "Awaiting portfolio",
            tone: "text-amber-300",
            icon: CircleGauge,
          },
          {
            label: "Limit alerts",
            value: "Trade checks active",
            tone: "text-slate-400",
            icon: ShieldAlert,
          },
          {
            label: "Orders stopped",
            value: "No account halt reported",
            tone: "text-slate-400",
            icon: Ban,
          },
          {
            label: "Quote freshness",
            value: "Checked at order",
            tone: "text-bronze-300",
            icon: Activity,
          },
        ].map((item) => (
          <div key={item.label} className="bg-panel p-5">
            <div className="flex items-center justify-between">
              <p className="data-label">{item.label}</p>
              <item.icon size={13} className="text-slate-500" />
            </div>
            <p className={`data-value mt-4 text-xl ${item.tone}`}>{item.value}</p>
          </div>
        ))}
      </div>
      <section className="m-4 rounded-lg border border-amber-400/20 bg-amber-400/[.05] p-5 text-xs leading-6 text-slate-300 md:m-6">
        <h2 className="text-sm font-semibold text-white">Your protection</h2>
        <p className="mt-2">Exposure for visible wallets.</p>
      </section>
      <section className="mx-4 border border-line bg-panel p-5 md:mx-6">
        <h2 className="text-sm font-semibold text-white">Solana wallet exposure</h2>
        <p className="mt-2 text-xs text-slate-400">
          Check balances and see how much of your wallet is concentrated in a single supported
          asset.
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
            className="rounded border border-bronze-400/30 px-3 text-xs text-bronze-300"
          >
            Inspect
          </button>
        </form>
        {solana && (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
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
              <p className="data-label">Largest priced token</p>
              <p className="mt-1 font-mono text-lg text-white">
                {walletObservation?.largestSharePct == null
                  ? "—"
                  : `${walletObservation.largestSharePct.toFixed(1)}%`}
              </p>
            </div>
            <div>
              <p className="data-label">Updated</p>
              <p className="mt-1 font-mono text-xs text-white">
                {new Date(solana.fetchedAt).toLocaleTimeString()}
              </p>
            </div>
          </div>
        )}
        {walletObservation && (
          <p className="mt-3 text-[10px] text-slate-500">
            $
            {walletObservation.pricedValueUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}{" "}
            priced tokens · {walletObservation.unpricedCount} unpriced ·{" "}
            {walletObservation.solValueUsd == null
              ? "SOL value pending"
              : `SOL spot ≈ $${walletObservation.solValueUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`}{" "}
            · estimated values
          </p>
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
        <p className="eyebrow">Public wallet view</p>
        <h2 className="mt-1 text-base font-semibold text-slate-100">
          Hyperliquid public wallet exposure
        </h2>
        <p className="mt-2 text-xs text-slate-400">
          Enter a public wallet address to explore its open perpetual positions and potential
          downside.
        </p>
        <form action="/risk" className="mt-4 flex flex-wrap gap-2">
          <input
            name="address"
            defaultValue={address}
            aria-label="Hyperliquid wallet address"
            placeholder="0x… public wallet address"
            className="min-w-64 flex-1 rounded border border-line bg-ink-raised px-3 py-2 font-mono text-xs text-slate-100"
          />
          <button
            type="submit"
            className="rounded border border-bronze-400/30 bg-bronze-400/10 px-4 py-2 text-xs font-semibold text-bronze-300"
          >
            View exposure
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
              <div key={label} className="bg-ink-raised p-4">
                <p className="data-label">{label}</p>
                <p className="mt-2 font-mono text-lg text-white">{value}</p>
              </div>
            ))}
          </div>
        )}
        {observed && (
          <p className="mt-3 font-mono text-[10px] text-slate-500">
            Updated {new Date(observed.fetchedAt).toLocaleTimeString()} · Public wallet view
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
            <span className="text-xs font-semibold">Trading limits</span>
            <span className="data-label">Live stock orders</span>
          </div>
          <div className="divide-y divide-line">
            {limits.map(([limit, value]) => (
              <div
                key={limit}
                className="grid grid-cols-[1fr_110px_90px] items-center gap-4 px-4 py-4"
              >
                <div>
                  <p className="text-[11px] text-slate-300">{limit}</p>
                  <div className="mt-2 h-1 max-w-sm bg-slate-800" />
                </div>
                <span className="data-value text-right text-[10px] text-slate-400">{value}</span>
                <span className="data-value text-right text-[10px] text-slate-500">Checked</span>
              </div>
            ))}
          </div>
        </section>
        <section className="border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-xs font-semibold">What if the market falls?</span>
            <Waves size={13} className="text-slate-400" />
          </div>
          <div className="divide-y divide-line">
            {scenarios.map((scenario) => {
              const covered =
                observed?.positions.filter((position) => scenario.shock(position.coin) !== null) ??
                [];
              const estimatedPnl = covered.reduce((total, position) => {
                const direction = Math.sign(Number(position.size));
                return (
                  total +
                  Math.abs(Number(position.notional)) *
                    direction *
                    (scenario.shock(position.coin) ?? 0)
                );
              }, 0);
              return (
                <div
                  key={scenario.name}
                  className="flex items-center justify-between gap-4 px-4 py-4"
                >
                  <div>
                    <p className="text-[11px] font-medium text-slate-300">{scenario.name}</p>
                    <p className="mt-1 font-mono text-[10px] text-slate-400">{scenario.detail}</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-mono text-xs ${signTone(estimatedPnl)}`}>
                      {observed && covered.length
                        ? `${estimatedPnl < 0 ? "−" : "+"}$${Math.abs(estimatedPnl).toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                        : observed
                          ? "No matching position"
                          : "No perpetual account in view"}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-400">
                      {covered.length}/{observed?.positions.length ?? 0} positions included
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-line p-3">
            <p className="text-[10px] leading-5 text-slate-500">
              Scenario estimates · visible perpetual positions.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
