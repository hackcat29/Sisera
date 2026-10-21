import { AlertTriangle, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { auth } from "../../../../auth";
import { BridgeUsdc } from "../../../../components/bridge-usdc";
import { FundAccountButton } from "../../../../components/fund-account";
import { PageHeader } from "../../../../components/page-header";
import { PerpPositions } from "../../../../components/perp-positions";
import { UnifiedPortfolio } from "../../../../components/platform/unified-portfolio";
import { PortfolioExport } from "../../../../components/portfolio-export";
import { PortfolioPrivyWallet } from "../../../../components/portfolio-privy-wallet";
import { PredictionPaperAccount } from "../../../../components/prediction-paper-account";
import { SwapToUsdc } from "../../../../components/swap-to-usdc";
import { TokenAvatar } from "../../../../components/token-avatar";
import { WithdrawButton } from "../../../../components/withdraw-funds";
import {
  accountErrorMessage,
  getPublicPerpAccount,
  getPublicStocks,
  getReferenceMarkets,
  getSolanaWallet,
} from "../../../../lib/api";
import { perpLogos } from "../../../../lib/asset-logo";
import { signTone } from "../../../../lib/sign";
import { valueSolanaWallet } from "../../../../lib/wallet-observation";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "Your Solana wallet, Hyperliquid account and trading book in one view.",
};

export const dynamic = "force-dynamic";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const usd = (value: number) =>
  `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const settle = <T,>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ value, error: null as unknown }),
    (error: unknown) => ({ value: null, error }),
  );

export default async function PortfolioPage({
  searchParams,
}: { searchParams: Promise<{ address?: string; solana?: string; watch?: string }> }) {
  const parameters = await searchParams;
  // `solana` and `address` are the signed-in user's own wallets, kept in the URL by
  // PortfolioPrivyWallet; `watch` is any other Hyperliquid account to observe read-only.
  const solanaAddress = parameters.solana?.trim() ?? "";
  const address = parameters.address?.trim() ?? "";
  const watchAddress = parameters.watch?.trim() ?? "";
  const validSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solanaAddress);
  const validAddress = /^0x[a-fA-F0-9]{40}$/.test(address);
  const validWatch = /^0x[a-fA-F0-9]{40}$/.test(watchAddress);
  const session = await auth();
  const signedIn = Boolean(session) || process.env.SISERA_LOCAL_OPERATOR_MODE === "true";
  const identity = {
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  };
  const [solanaResult, ownPerps, watchResult, stocks, references] = await Promise.all([
    settle(validSolana ? getSolanaWallet(solanaAddress, identity) : Promise.resolve(null)),
    settle(validAddress ? getPublicPerpAccount(address, identity) : Promise.resolve(null)),
    settle(validWatch ? getPublicPerpAccount(watchAddress, identity) : Promise.resolve(null)),
    (validSolana ? getPublicStocks(identity) : Promise.resolve([])).catch(() => []),
    (validSolana ? getReferenceMarkets(["SOLUSDT"], identity) : Promise.resolve([])).catch(
      () => [],
    ),
  ]);
  const solana = solanaResult.value;
  const wallet = solana ? valueSolanaWallet(solana, stocks, references) : null;
  const perps = ownPerps.value;
  const observed = watchResult.value;

  const solanaValue = wallet ? wallet.pricedValueUsd + (wallet.solValueUsd ?? 0) : null;
  const perpEquity = perps ? Number(perps.accountValue) : null;
  const unrealized = perps?.positions.reduce((sum, item) => sum + Number(item.unrealizedPnl), 0);
  const total = (solanaValue ?? 0) + (perpEquity ?? 0);
  const readyUsdc = (wallet?.stablecoinUsd ?? 0) + (perps ? Number(perps.withdrawable) : 0);
  const loaded = solana != null || perps != null;
  const summary: Array<[string, string, string]> = [
    ["Total balance", loaded ? usd(total) : "—", "Solana wallet plus Hyperliquid account"],
    ["Ready to trade", loaded ? usd(readyUsdc) : "—", "USDC in your wallet and Hyperliquid"],
    ["Hyperliquid equity", perpEquity == null ? "—" : usd(perpEquity), "Perps margin and P&L"],
    ["Unrealized P&L", unrealized == null ? "—" : usd(unrealized), "Open Hyperliquid positions"],
  ];

  return (
    <div className="min-h-full">
      <Suspense fallback={null}>
        <PortfolioPrivyWallet mode="linked" />
      </Suspense>
      <PageHeader
        eyebrow="Your assets"
        title="Portfolio"
        description="Your Solana wallet, Hyperliquid account and trading book, reconciled against your wallets."
        actions={
          <div className="flex flex-wrap gap-2">
            <FundAccountButton />
            <WithdrawButton />
          </div>
        }
      />

      {signedIn && loaded && total < 1 && (
        <section className="m-4 border border-bronze-400/30 bg-bronze-400/[0.05] p-5 md:m-6">
          <p className="eyebrow">Get started</p>
          <h2 className="mt-2 text-base font-semibold text-slate-100">
            Fund your account to trade
          </h2>
          <ol className="mt-4 grid gap-3 text-xs md:grid-cols-3">
            {[
              [
                "1. Deposit",
                "Send USDC, SOL or any token to your Sisera wallet on Solana or an EVM chain.",
              ],
              ["2. Convert to USDC", "Swap what you deposited to USDC below in one step."],
              [
                "3. Trade",
                "Buy tokenized stocks, trade predictions, or open perps on Hyperliquid.",
              ],
            ].map(([title, copy]) => (
              <li key={title} className="border border-line bg-panel p-3">
                <p className="font-semibold text-slate-100">{title}</p>
                <p className="mt-1 leading-5 text-slate-400">{copy}</p>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <FundAccountButton />
            <Link
              href="/stocks"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-[12px] text-slate-200 hover:border-slate-500"
            >
              Explore markets <ArrowRight size={13} />
            </Link>
          </div>
        </section>
      )}

      <div className="grid gap-px border-y border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        {summary.map(([label, value, hint]) => (
          <div key={label} className="bg-panel p-5">
            <p className="data-label">{label}</p>
            <p
              className={`data-value mt-4 text-2xl ${label === "Unrealized P&L" && unrealized != null ? signTone(unrealized) : "text-slate-100"}`}
            >
              {value}
            </p>
            <p className="mt-2 text-[11px] text-slate-500">{hint}</p>
          </div>
        ))}
      </div>

      <UnifiedPortfolio />

      <section className="m-4 border border-line bg-panel p-5 md:m-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Solana</p>
            <h2 className="mt-2 text-base font-semibold text-slate-100">Solana wallet</h2>
            {validSolana && (
              <p className="mt-1 break-all font-mono text-[10px] text-slate-500">{solanaAddress}</p>
            )}
          </div>
          {wallet && solana && (
            <PortfolioExport
              rows={wallet.holdings.map((holding) => ({
                source: holding.source,
                asset: holding.symbol,
                quantity: String(holding.amount),
                observedPriceUsd: holding.priceUsd == null ? "" : String(holding.priceUsd),
                observedValueUsd: holding.valueUsd == null ? "" : String(holding.valueUsd),
                observedAt: solana.fetchedAt,
              }))}
            />
          )}
        </div>
        {!validSolana && (
          <p className="mt-4 text-xs text-slate-400">
            {signedIn ? "Loading your wallet…" : "Sign in to see your wallet."}
          </p>
        )}
        {validSolana && !solana && (
          <p className="mt-4 text-xs text-amber-300">
            {solanaResult.error
              ? accountErrorMessage(solanaResult.error)
              : "Solana wallet balances are unavailable."}
          </p>
        )}
        {solana && wallet && (
          <div className="mt-4 divide-y divide-line border-t border-line text-xs">
            <div className="flex items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-3">
                <TokenAvatar src={perpLogos("SOL")} symbol="SOL" />
                <div>
                  <p className="font-semibold text-slate-100">SOL</p>
                  <p className="text-[10px] text-slate-500">Network fees</p>
                </div>
              </div>
              <div className="text-right font-mono">
                <p className="text-slate-100">
                  {wallet.solValueUsd == null ? "—" : usd(wallet.solValueUsd)}
                </p>
                <p className="text-[10px] text-slate-500">
                  {(Number(solana.solLamports) / 1e9).toLocaleString("en-US", {
                    maximumFractionDigits: 4,
                  })}{" "}
                  SOL
                </p>
              </div>
            </div>
            {wallet.holdings.map((holding) => (
              <div key={holding.mint} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <TokenAvatar src={holding.icon} symbol={holding.symbol} />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-100">
                      {holding.symbol}
                      {holding.mint === USDC && (
                        <span className="ml-2 rounded bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-normal text-emerald-300">
                          Ready to trade
                        </span>
                      )}
                    </p>
                    <p className="truncate text-[10px] text-slate-500">
                      {holding.name ?? `${holding.mint.slice(0, 6)}…${holding.mint.slice(-4)}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {holding.mint !== USDC && holding.valueUsd != null && (
                    <Link
                      href="#swap"
                      className="hidden rounded border border-line px-2 py-1 text-[10px] text-slate-300 hover:border-bronze-400/50 sm:inline"
                    >
                      Swap to USDC
                    </Link>
                  )}
                  <div className="text-right font-mono">
                    <p className="text-slate-100">
                      {holding.valueUsd == null ? "No price" : usd(holding.valueUsd)}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {holding.amount.toLocaleString("en-US", { maximumFractionDigits: 6 })}{" "}
                      {holding.symbol}
                    </p>
                  </div>
                </div>
              </div>
            ))}
            {!wallet.holdings.length && Number(solana.solLamports) === 0 && (
              <p className="py-4 text-slate-500">
                This wallet is empty. Use Deposit to see your address.
              </p>
            )}
          </div>
        )}
        {wallet && wallet.suspicious.length > 0 && (
          <details className="mt-3 border border-amber-400/20 bg-amber-400/[0.04] p-3 text-xs">
            <summary className="flex cursor-pointer items-center gap-2 text-amber-200">
              <AlertTriangle size={13} />
              {wallet.suspicious.length} unverified{" "}
              {wallet.suspicious.length === 1 ? "token" : "tokens"} hidden
            </summary>
            <p className="mt-2 leading-5 text-slate-400">
              These tokens were sent to your wallet but are unverified or can't be sold, and some
              imitate real tokens. They're excluded from your balance. Don't interact with links or
              sites they point to.
            </p>
            <ul className="mt-2 space-y-1 font-mono text-[10px] text-slate-500">
              {wallet.suspicious.map((holding) => (
                <li key={holding.mint}>
                  {holding.amount.toLocaleString("en-US")} {holding.symbol} · {holding.mint}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section id="hyperliquid" className="m-4 scroll-mt-20 border border-line bg-panel p-5 md:m-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Hyperliquid</p>
            <h2 className="mt-2 text-base font-semibold text-slate-100">Hyperliquid account</h2>
            <p className="mt-1 text-xs text-slate-400">
              Your perps and spot account. Trade it from{" "}
              <Link
                href="/terminal?venue=hyperliquid"
                className="text-bronze-300 hover:text-bronze-200"
              >
                Perpetuals
              </Link>{" "}
              and{" "}
              <Link href="/markets" className="text-bronze-300 hover:text-bronze-200">
                Crypto spot
              </Link>
              .
            </p>
          </div>
        </div>
        <PerpPositions />
      </section>

      <SwapToUsdc excludedMints={stocks.map((stock) => stock.mint)} />
      <BridgeUsdc />

      <details className="mx-4 mt-4 border border-line md:mx-6">
        <summary className="cursor-pointer px-4 py-3 text-xs text-slate-400">
          Practice account
        </summary>
        <div className="px-4 pb-4">
          <PredictionPaperAccount />
        </div>
      </details>

      <details
        className="mx-4 mb-6 mt-4 border border-line md:mx-6"
        {...(watchAddress ? { open: true } : {})}
      >
        <summary className="cursor-pointer px-4 py-3 text-xs text-slate-400">
          Watch another Hyperliquid account
        </summary>
        <div className="px-4 pb-4">
          <form action="/portfolio" className="flex flex-wrap gap-2">
            {validSolana && <input type="hidden" name="solana" value={solanaAddress} />}
            {validAddress && <input type="hidden" name="address" value={address} />}
            <input
              name="watch"
              defaultValue={watchAddress}
              aria-label="Hyperliquid wallet address"
              placeholder="0x… any public address"
              className="min-w-64 flex-1 rounded border border-line bg-ink-raised px-3 py-2 font-mono text-xs text-slate-100"
            />
            <button
              type="submit"
              className="rounded border border-bronze-400/30 bg-bronze-400/10 px-4 py-2 text-xs font-semibold text-bronze-300"
            >
              View account
            </button>
          </form>
          {watchAddress && !validWatch && (
            <p className="mt-2 text-xs text-rose-300">Enter a 42-character 0x address.</p>
          )}
          {validWatch && !observed && (
            <p className="mt-2 text-xs text-amber-300">
              {watchResult.error
                ? accountErrorMessage(watchResult.error)
                : "This account's state is unavailable."}
            </p>
          )}
          {observed && (
            <div className="mt-4 overflow-x-auto">
              <p className="font-mono text-[10px] text-slate-500">
                Read-only · equity {usd(Number(observed.accountValue))} · updated{" "}
                {new Date(observed.fetchedAt).toLocaleTimeString()}
              </p>
              <table className="mt-2 w-full min-w-[620px] text-left text-xs">
                <thead className="font-mono text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Market</th>
                    <th>Size</th>
                    <th>Entry</th>
                    <th>Notional</th>
                    <th>Unrealized P&amp;L</th>
                    <th>Liquidation</th>
                  </tr>
                </thead>
                <tbody>
                  {observed.positions.map((position) => (
                    <tr
                      key={position.coin}
                      className="border-t border-line font-mono text-slate-300"
                    >
                      <td className="py-2 text-slate-100">
                        <TokenAvatar
                          src={perpLogos(position.coin)}
                          symbol={position.coin}
                          size={18}
                          className="mr-2 inline-grid rounded-full align-middle"
                        />
                        {position.coin} · {position.leverage}x
                      </td>
                      <td>{position.size}</td>
                      <td>{position.entryPrice}</td>
                      <td>{usd(Number(position.notional))}</td>
                      <td className={signTone(Number(position.unrealizedPnl))}>
                        {usd(Number(position.unrealizedPnl))}
                      </td>
                      <td>{position.liquidationPrice ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!observed.positions.length && (
                <p className="py-3 text-xs text-slate-500">No open positions.</p>
              )}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
