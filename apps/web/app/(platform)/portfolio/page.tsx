import { StatusBadge } from "@sisera/ui";
import { BriefcaseBusiness, Download, Layers3, RefreshCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { auth } from "../../../auth";
import { BridgeUsdc } from "../../../components/bridge-usdc";
import { EmptyState } from "../../../components/empty-state";
import { PageHeader } from "../../../components/page-header";
import { PortfolioConnect } from "../../../components/portfolio-connect";
import { PortfolioPrivyWallet } from "../../../components/portfolio-privy-wallet";
import { PredictionPaperAccount } from "../../../components/prediction-paper-account";
import {
  accountErrorMessage,
  getHyperEvmWallet,
  getPublicPerpAccount,
  getSolanaWallet,
} from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function PortfolioPage({
  searchParams,
}: { searchParams: Promise<{ address?: string; solana?: string; watch?: string }> }) {
  const parameters = await searchParams;
  const address = parameters.address?.trim() ?? "";
  const solanaAddress = parameters.solana?.trim() ?? "";
  const watchAddress = parameters.watch?.trim() ?? "";
  const observedAddress = watchAddress || address;
  const validSolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solanaAddress);
  const validAddress = /^0x[a-fA-F0-9]{40}$/.test(address);
  const validObservedAddress = /^0x[a-fA-F0-9]{40}$/.test(observedAddress);
  const session = await auth();
  const identity = {
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  };
  const [solanaResult, observedResult, hyperEvmResult] = await Promise.all([
    (validSolanaAddress ? getSolanaWallet(solanaAddress, identity) : Promise.resolve(null)).then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null, error }),
    ),
    (validObservedAddress
      ? getPublicPerpAccount(observedAddress, identity)
      : Promise.resolve(null)
    ).then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null, error }),
    ),
    (validAddress ? getHyperEvmWallet(address, identity) : Promise.resolve(null)).then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null, error }),
    ),
  ]);
  const solana = solanaResult.value;
  const observed = observedResult.value;
  const hyperEvm = hyperEvmResult.value;
  const unrealizedPnl = observed?.positions.reduce(
    (sum, position) => sum + Number(position.unrealizedPnl),
    0,
  );
  const summary = [
    [
      "Observed perp account value",
      observed ? `$${Number(observed.accountValue).toLocaleString()}` : "—",
    ],
    ["Solana cash", solana ? `${(Number(solana.solLamports) / 1e9).toFixed(4)} SOL` : "—"],
    ["HyperEVM USDC", hyperEvm ? `$${(Number(hyperEvm.usdcRaw) / 1e6).toLocaleString()}` : "—"],
    [
      "Perp gross exposure",
      observed ? `$${Math.abs(Number(observed.notionalExposure)).toLocaleString()}` : "—",
    ],
    ["Perp positions", observed ? String(observed.positions.length) : "—"],
    ["Unrealized perp P&L", unrealizedPnl == null ? "—" : `$${unrealizedPnl.toLocaleString()}`],
  ];
  return (
    <div className="min-h-full">
      <Suspense fallback={null}>
        <PortfolioPrivyWallet mode="linked" />
      </Suspense>
      <PageHeader
        eyebrow="Connected account observations"
        title="Portfolio"
        description="Inspect connected-wallet balances, paper holdings, and optional public perp accounts. Sources are shown separately until their records can be reconciled."
        actions={
          <div className="flex items-center gap-2">
            <PortfolioConnect />
          </div>
        }
      />
      <div className="grid gap-px border-b border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
        {summary.map(([label, value]) => (
          <div key={label} className="bg-panel p-5">
            <p className="data-label">{label}</p>
            <p className="data-value mt-4 text-2xl text-slate-100">{value}</p>
            <p className="mt-2 font-mono text-[8px] uppercase tracking-wider text-slate-700">
              {value === "—" ? "Connect a source" : "Observed · not reconciled"}
            </p>
          </div>
        ))}
      </div>
      <section className="m-4 border border-line bg-panel p-5 md:m-6">
        <p className="eyebrow">Solana</p>
        <h2 className="mt-2 text-base font-semibold text-slate-100">Linked wallet observation</h2>
        <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400">
          The connected wallet’s public balances appear here after its address is synced. Holdings
          are observations and have not been reconciled against an account ledger.
        </p>
        {solanaAddress && !validSolanaAddress && (
          <p className="mt-2 text-xs text-rose-300">Enter a valid base58 Solana address.</p>
        )}
        {validSolanaAddress && !solana && (
          <p className="mt-2 text-xs text-amber-300">
            {solanaResult.error
              ? accountErrorMessage(solanaResult.error)
              : "Solana wallet balances are unavailable."}
          </p>
        )}
        {solana && (
          <div className="mt-5">
            <p className="font-mono text-[10px] text-slate-500">
              {solana.source} · fetched {new Date(solana.fetchedAt).toLocaleTimeString()} · not
              reconciled
            </p>
            <p className="mt-3 font-mono text-xl text-white">
              {(Number(solana.solLamports) / 1e9).toFixed(4)} SOL
            </p>
            <div className="mt-4 divide-y divide-line border-t border-line">
              {solana.holdings.map((holding) => (
                <div
                  key={holding.mint}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs"
                >
                  <div>
                    <p className="font-semibold text-slate-100">
                      {holding.symbol ?? holding.name ?? "Unknown token"}
                    </p>
                    <p className="mt-1 break-all font-mono text-[10px] text-slate-500">
                      {holding.mint}
                    </p>
                  </div>
                  <p className="font-mono text-slate-200">
                    {(Number(holding.rawBalance) / 10 ** holding.decimals).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
            {!solana.holdings.length && (
              <p className="mt-4 text-xs text-slate-500">No indexed fungible holdings reported.</p>
            )}
          </div>
        )}
      </section>
      <div className="mx-4 mt-4 md:mx-6">
        <PredictionPaperAccount />
      </div>
      <section className="m-4 border border-line bg-panel p-5 md:m-6">
        <p className="eyebrow">HyperEVM · chain 999</p>
        <h2 className="mt-2 text-base font-semibold text-slate-100">Funding wallet</h2>
        <p className="mt-2 break-all font-mono text-[10px] text-slate-500">
          {validAddress ? address : "Connect an EVM wallet or enter its address below."}
        </p>
        {hyperEvm ? (
          <div className="mt-4 flex flex-wrap gap-6 font-mono text-sm text-slate-200">
            <span>{(Number(hyperEvm.usdcRaw) / 1e6).toLocaleString()} USDC</span>
            <span>{(Number(hyperEvm.hypeWei) / 1e18).toFixed(5)} HYPE</span>
            <span className="text-[10px] text-slate-500">
              {hyperEvm.source} · {new Date(hyperEvm.fetchedAt).toLocaleTimeString()}
            </span>
          </div>
        ) : validAddress ? (
          <p className="mt-4 text-xs text-amber-300">
            {hyperEvmResult.error
              ? accountErrorMessage(hyperEvmResult.error)
              : "HyperEVM wallet balances are unavailable."}
          </p>
        ) : null}
      </section>
      <section className="m-4 border border-line bg-panel p-5 md:m-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Public onchain observation</p>
            <h2 className="mt-1 text-base font-semibold text-slate-100">
              Watch a Hyperliquid perp wallet
            </h2>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400">
              Read-only clearinghouse state for an address you supply. This is not custody, account
              verification, or a reconciled Sisera portfolio.
            </p>
          </div>
          {observed && (
            <Link
              href={`/risk?address=${encodeURIComponent(observedAddress)}`}
              className="rounded border border-cyan-400/30 px-3 py-2 text-xs text-cyan-300"
            >
              Review observed exposure →
            </Link>
          )}
        </div>
        <form action="/portfolio" className="mt-4 flex flex-wrap gap-2">
          <input
            name="watch"
            defaultValue={watchAddress}
            aria-label="Hyperliquid wallet address"
            placeholder="0x… public wallet address"
            className="min-w-64 flex-1 rounded border border-line bg-[#0f1a22] px-3 py-2 font-mono text-xs text-slate-100"
          />
          <button
            type="submit"
            className="rounded border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-xs font-semibold text-cyan-300"
          >
            Observe wallet
          </button>
        </form>
        {watchAddress && !validObservedAddress && (
          <p className="mt-2 text-xs text-rose-300">Enter a 42-character 0x address.</p>
        )}
        {validObservedAddress && !observed && (
          <p className="mt-2 text-xs text-amber-300">
            {observedResult.error
              ? accountErrorMessage(observedResult.error)
              : "Hyperliquid account state is unavailable for this address."}
          </p>
        )}
        {observed && (
          <div className="mt-5">
            <p className="font-mono text-[10px] text-slate-500">
              {observed.source} · fetched {new Date(observed.fetchedAt).toLocaleTimeString()} ·
              public read-only observation
            </p>
            <div className="mt-3 grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Account value", observed.accountValue],
                ["Notional exposure", observed.notionalExposure],
                ["Margin used", observed.marginUsed],
                ["Withdrawable", observed.withdrawable],
              ].map(([label, value]) => (
                <div key={label} className="bg-[#101b23] p-4">
                  <p className="data-label">{label}</p>
                  <p className="mt-2 font-mono text-lg text-white">
                    ${Number(value).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="font-mono text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="py-3">Perp</th>
                    <th>Size</th>
                    <th>Entry</th>
                    <th>Notional</th>
                    <th>Unrealized P&L</th>
                    <th>Margin</th>
                    <th>Liquidation</th>
                  </tr>
                </thead>
                <tbody>
                  {observed.positions.map((position) => (
                    <tr
                      key={position.coin}
                      className="border-t border-line font-mono text-slate-300"
                    >
                      <td className="py-3 font-semibold text-white">
                        {position.coin} · {position.marginType} {position.leverage}x
                      </td>
                      <td>{position.size}</td>
                      <td>{position.entryPrice}</td>
                      <td>${Number(position.notional).toLocaleString()}</td>
                      <td
                        className={
                          Number(position.unrealizedPnl) >= 0 ? "text-emerald-300" : "text-rose-300"
                        }
                      >
                        {position.unrealizedPnl}
                      </td>
                      <td>{position.marginUsed}</td>
                      <td>{position.liquidationPrice ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!observed.positions.length && (
                <p className="border-t border-line py-4 text-xs text-slate-500">
                  No open perpetual positions reported.
                </p>
              )}
            </div>
          </div>
        )}
      </section>
      <div className="grid gap-4 p-4 xl:grid-cols-[1.45fr_.55fr]">
        <section className="border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-xs font-semibold">Observed Hyperliquid positions</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled
                className="flex items-center gap-1.5 text-[9px] text-slate-700"
              >
                <RefreshCcw size={11} /> Reconcile
              </button>
              <button
                type="button"
                disabled
                className="flex items-center gap-1.5 text-[9px] text-slate-700"
              >
                <Download size={11} /> Export
              </button>
            </div>
          </div>
          <div className="grid grid-cols-[1.4fr_repeat(5,1fr)] border-b border-line bg-[#090e14] px-4 py-2 data-label">
            <span>Instrument</span>
            <span className="text-right">Position</span>
            <span className="text-right">Entry</span>
            <span className="text-right">Mark</span>
            <span className="text-right">Unrealized</span>
            <span className="text-right">Exposure</span>
          </div>
          {observed?.positions.length ? (
            <div className="divide-y divide-line">
              {observed.positions.map((position) => (
                <div
                  key={position.coin}
                  className="grid grid-cols-[1.4fr_repeat(5,1fr)] gap-2 px-4 py-3 text-[11px] font-mono text-slate-300"
                >
                  <span>{position.coin} perpetual</span>
                  <span className="text-right">{position.size}</span>
                  <span className="text-right">{position.entryPrice}</span>
                  <span className="text-right">—</span>
                  <span className="text-right">
                    ${Number(position.unrealizedPnl).toLocaleString()}
                  </span>
                  <span className="text-right">${Number(position.notional).toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={BriefcaseBusiness}
              title="No observed positions"
              copy="Connect a Hyperliquid public address to inspect its reported open positions."
              code="PORTFOLIO / EMPTY"
            />
          )}
        </section>
        <div className="space-y-4">
          <section className="border border-line bg-panel">
            <div className="border-b border-line px-4 py-3 text-xs font-semibold">Allocation</div>
            <EmptyState
              icon={Layers3}
              title="No allocation data"
              copy="Allocation remains blank until portfolio truth is available."
              code="ALLOCATION / EMPTY"
            />
          </section>
          <section className="border border-emerald-500/15 bg-emerald-500/[0.035] p-4">
            <ShieldCheck size={16} className="text-emerald-300" />
            <h3 className="mt-4 text-xs font-semibold text-slate-200">
              Reconciliation is mandatory
            </h3>
            <p className="mt-2 text-[10px] leading-5 text-slate-500">
              Venue balances are compared with Sisera’s double-entry ledger before positions can
              influence risk limits or order sizing.
            </p>
          </section>
        </div>
      </div>
      <BridgeUsdc />
    </div>
  );
}
