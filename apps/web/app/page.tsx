import { ArrowRight, ArrowUpRight, Bot, ChartNoAxesCombined, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { SiseraMark } from "../components/sisera-mark";
import { getPrivateMarkets, getPublicStocks } from "../lib/api";

export const dynamic = "force-dynamic";

const currency = (value: string | null | undefined) => {
  if (value == null || !Number.isFinite(Number(value))) return "Unavailable";
  return Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value));
};

export default async function LandingPage() {
  const [stocks, privateMarkets] = await Promise.all([
    getPublicStocks({}).catch(() => []),
    getPrivateMarkets({}).catch(() => []),
  ]);
  const publicAsset =
    stocks.find((stock) => stock.symbol === "AAPLx") ?? stocks.find((stock) => stock.dexPriceUsd);
  const privateAsset =
    privateMarkets.find((asset) => asset.instrument.baseAsset === "OPENAI") ?? privateMarkets[0];
  const publicPrice = publicAsset?.dexPriceUsd ?? null;
  const privatePremium = privateAsset ? Number(privateAsset.premiumDiscountPct) : null;

  return (
    <main className="min-h-screen bg-ink text-slate-100">
      <header className="sticky top-0 z-40 border-b border-line bg-[#101b23]/95 backdrop-blur">
        <div className="mx-auto flex h-[70px] max-w-[1400px] items-center justify-between px-5 md:px-10">
          <Link href="/" className="flex items-center gap-3" aria-label="Sisera home">
            <SiseraMark size={32} />
            <span className="text-[17px] font-semibold tracking-[0.14em] text-white">SISERA</span>
          </Link>
          <Link
            href="/stocks"
            className="inline-flex items-center gap-2 rounded bg-cyan-300 px-4 py-2 text-xs font-semibold text-[#14202a] hover:bg-cyan-200"
          >
            Open terminal <ArrowUpRight size={14} />
          </Link>
        </div>
      </header>

      <section className="border-b border-line px-5 py-16 md:px-10 md:py-24">
        <div className="mx-auto max-w-[1400px]">
          <p className="eyebrow">Intelligence for onchain stock markets</p>
          <h1 className="mt-6 max-w-5xl text-[clamp(2.7rem,5.5vw,5.6rem)] font-medium leading-[1.04] tracking-[-0.05em] text-[#f4f0e9]">
            See the market. Check the evidence. Control the trade.
          </h1>
          <p className="mt-7 max-w-2xl text-base leading-8 text-slate-300">
            Sisera brings Solana tokenized stocks, private-market tokens, market research, paper
            trading, portfolio observations, risk controls, and agent research into one workspace.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/stocks"
              className="inline-flex items-center gap-2 rounded bg-cyan-300 px-5 py-3 text-xs font-semibold text-[#14202a] hover:bg-cyan-200"
            >
              Explore public stocks <ArrowRight size={15} />
            </Link>
            <Link
              href="/private-markets"
              className="inline-flex items-center gap-2 rounded border border-line px-5 py-3 text-xs font-semibold text-slate-200 hover:border-slate-500"
            >
              Explore private markets <ArrowUpRight size={14} />
            </Link>
          </div>
          <p className="mt-5 text-xs text-slate-500">
            Paper trading and research are available in the terminal. Live orders remain gated until
            account, wallet, and risk checks pass.
          </p>
        </div>
      </section>

      <section className="px-5 py-12 md:px-10">
        <div className="mx-auto max-w-[1400px]">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow">Observed markets</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">A current starting point</h2>
            </div>
            <p className="text-xs text-slate-500">
              Provider observations, not firm execution quotes
            </p>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <Link
              href={publicAsset ? `/stocks/${encodeURIComponent(publicAsset.symbol)}` : "/stocks"}
              className="rounded-lg border border-line bg-panel p-6 hover:border-cyan-400/40"
            >
              <span className="text-[10px] uppercase tracking-widest text-cyan-300">
                Public stock · Solana
              </span>
              <h3 className="mt-3 text-lg font-semibold text-white">
                {publicAsset?.name ?? "Public stock market"}
              </h3>
              <p className="mt-4 font-mono text-3xl text-white">{currency(publicPrice)}</p>
              <p className="mt-2 text-xs text-slate-400">
                Observed token quote · {publicAsset?.symbol ?? "feed unavailable"}
              </p>
              {publicAsset && (
                <p className="mt-4 text-[11px] text-slate-500">
                  Fetched {new Date(publicAsset.fetchedAt).toLocaleString()}
                </p>
              )}
            </Link>
            <Link
              href={
                privateAsset
                  ? `/private-markets/${encodeURIComponent(privateAsset.instrument.baseAsset)}`
                  : "/private-markets"
              }
              className="rounded-lg border border-line bg-panel p-6 hover:border-cyan-400/40"
            >
              <span className="text-[10px] uppercase tracking-widest text-cyan-300">
                Private market · PreStocks
              </span>
              <h3 className="mt-3 text-lg font-semibold text-white">
                {privateAsset?.company ?? "Private-market feed"}
              </h3>
              <p className="mt-4 font-mono text-3xl text-white">
                {currency(privateAsset?.tokenPrice)}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Provider mark {currency(privateAsset?.markPrice)} ·{" "}
                {privatePremium == null
                  ? "premium unavailable"
                  : `${privatePremium >= 0 ? "+" : ""}${privatePremium.toFixed(2)}% premium / discount`}
              </p>
              {privateAsset && (
                <p className="mt-4 text-[11px] text-slate-500">
                  Fetched {new Date(privateAsset.fetchedAt).toLocaleString()}
                </p>
              )}
            </Link>
            <Link
              href="/agents"
              className="rounded-lg border border-line bg-panel p-6 hover:border-cyan-400/40"
            >
              <span className="text-[10px] uppercase tracking-widest text-cyan-300">
                Agent workspace
              </span>
              <h3 className="mt-3 text-lg font-semibold text-white">Research and drafts</h3>
              <p className="mt-4 font-mono text-xl text-white">Research only</p>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                Inspect strategy templates and run evidence-backed research. Agent execution is not
                enabled.
              </p>
            </Link>
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-[#101b23] px-5 py-14 md:px-10">
        <div className="mx-auto max-w-[1400px]">
          <p className="eyebrow">One decision workflow</p>
          <h2 className="mt-2 max-w-3xl text-3xl font-semibold text-white">
            From an observed market to a reviewed decision.
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: ChartNoAxesCombined,
                title: "Discover",
                body: "Screen tokenized markets by quote, movement, liquidity, and provider mark. Open an asset to inspect its source and freshness.",
              },
              {
                icon: Bot,
                title: "Research",
                body: "Review company news and on-demand assessments. Agent templates can evaluate current evidence without placing orders.",
              },
              {
                icon: ShieldCheck,
                title: "Control",
                body: "Review paper orders, observed holdings, and risk state. Live execution requires explicit account and policy checks.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-lg border border-line bg-panel p-6">
                <Icon size={19} className="text-cyan-300" />
                <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="px-5 py-10 md:px-10">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>Sisera · Research and trading workspace</span>
          <div className="flex flex-wrap gap-5">
            <Link href="/stocks" className="hover:text-white">
              Stocks
            </Link>
            <Link href="/private-markets" className="hover:text-white">
              Private markets
            </Link>
            <Link href="/agents" className="hover:text-white">
              Agents
            </Link>
            <Link href="/portfolio" className="hover:text-white">
              Portfolio
            </Link>
          </div>
          <span>
            Market prices and provider marks can differ. Review each order before submitting.
          </span>
        </div>
      </footer>
    </main>
  );
}
