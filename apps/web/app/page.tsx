import { ArrowRight, ArrowUpRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "../components/site-chrome";
import {
  StructuredData,
  applicationSchema,
  faqSchema,
  organizationSchema,
  websiteSchema,
} from "../components/structured-data";
import { TickerTape } from "../components/ticker-tape";
import { getMarketOverview, getPrivateMarkets, getPublicStocks } from "../lib/api";
import { signTone } from "../lib/sign";
import { faqs, site } from "../lib/site";
import candlesImage from "../public/brand/bronze-candles.jpg";
import coinsImage from "../public/brand/bronze-coins.jpg";
import gatesImage from "../public/brand/bronze-gates.jpg";
import vaultImage from "../public/brand/bronze-vault.jpg";
import ribbon from "../public/brand/sisera-signal.png";
import screenIntelligence from "../public/screens/intelligence.png";
import screenPrivate from "../public/screens/private-markets.png";
import screenStock from "../public/screens/stock-detail.png";
import screenStocks from "../public/screens/stocks.png";

export const revalidate = 60;

const money = (value: number | string | null | undefined, compact = false) =>
  value == null || !Number.isFinite(Number(value))
    ? null
    : Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        ...(compact
          ? { notation: "compact" as const, maximumFractionDigits: 1 }
          : { maximumFractionDigits: 2 }),
      }).format(Number(value));

const signedPct = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

const lifecycle = [
  ["Draft", "Policy compiled and hashed: universe, factors, capital and drawdown caps."],
  ["Backtest", "Historical evaluation against the declared universe and timeframe."],
  ["Stress test", "Flash crashes, liquidity freezes, and de-pegs."],
  ["Paper", "Forward execution against live order books with no capital."],
  ["Shadow", "Runs beside live order flow and is compared, not executed."],
  ["Limited live", "A small share of the allocation, under supervision."],
  ["Live", "Full allocation with real-time risk supervision."],
] as const;

const safeguards = [
  [
    "Proposals, not orders",
    "Agents compile to a policy with execution set to proposal-only. An operator places every order.",
  ],
  [
    "Hard limits in the manifest",
    "Capital cap, per-trade notional, daily drawdown, open positions, stop-loss, take-profit, and slippage are declared up front and hashed.",
  ],
  [
    "Kill switch by default",
    "Every draft carries a cancel-all-and-halt action and declares sandbox limits for CPU, memory, and network access.",
  ],
  [
    "Practice by choice",
    "Live order entry is the default. Optional practice accounts let you rehearse a thesis before funding it.",
  ],
] as const;

function Screen({
  src,
  alt,
  priority = false,
}: {
  src: typeof screenStocks;
  alt: string;
  priority?: boolean;
}) {
  return (
    <figure className="border border-line bg-ink-deep p-1.5">
      <div className="flex h-6 items-center gap-1.5 border-b border-line px-2">
        <span className="size-1.5 rounded-full bg-line-strong" />
        <span className="size-1.5 rounded-full bg-line-strong" />
        <span className="size-1.5 rounded-full bg-line-strong" />
        <span className="ml-3 font-mono text-[10px] text-slate-400">sisera.xyz</span>
      </div>
      <Image
        src={src}
        alt={alt}
        priority={priority}
        sizes="(min-width: 1280px) 760px, 100vw"
        className="h-auto w-full"
      />
    </figure>
  );
}

/** A full-bleed bronze image with its section's headline set in the image's empty space. */
function Chapter({
  image,
  align,
  eyebrow,
  title,
  body,
}: {
  image: typeof candlesImage;
  align: "left" | "right" | "top";
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="relative overflow-hidden border-b border-line bg-[#0a0f18]">
      <Image
        src={image}
        alt=""
        sizes="100vw"
        className={`w-full object-cover ${
          align === "top" ? "h-[520px] object-bottom md:h-[680px]" : "h-[420px] md:h-[520px]"
        }`}
      />
      <div
        className={`absolute inset-0 mx-auto flex max-w-[1320px] px-4 md:px-8 ${
          align === "top"
            ? "items-start pt-12 md:pt-16"
            : `items-center ${align === "right" ? "justify-end" : "justify-start"}`
        }`}
      >
        <div className="max-w-xl">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="display mt-4 text-[clamp(2.25rem,4.5vw,3.5rem)] leading-[1.02] text-bone">
            {title}
          </h2>
          <p className="mt-5 max-w-lg text-[15px] leading-7 text-slate-300">{body}</p>
        </div>
      </div>
    </div>
  );
}

export default async function LandingPage() {
  const identity = {};
  const [stocks, privateMarkets, overview] = await Promise.all([
    getPublicStocks(identity).catch(() => []),
    getPrivateMarkets(identity).catch(() => []),
    getMarketOverview(identity).catch(() => null),
  ]);
  const movers = stocks
    .filter((item) => item.dexPriceUsd && item.change24hPct != null)
    .sort((a, b) => Math.abs(b.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0))
    .slice(0, 6);
  const privateGaps = privateMarkets
    .filter((item) => Number.isFinite(Number(item.premiumDiscountPct)))
    .sort((a, b) => Math.abs(Number(b.premiumDiscountPct)) - Math.abs(Number(a.premiumDiscountPct)))
    .slice(0, 6);
  const tokenizedVolume = stocks.reduce((total, stock) => total + (stock.volume24hUsd ?? 0), 0);
  const tradingStocks = stocks.filter((stock) => stock.dexPriceUsd != null).length;

  // Live figures when the market API answers; otherwise, coverage facts that are always true.
  const proof: Array<[string, string]> =
    stocks.length || privateMarkets.length
      ? [
          [stocks.length.toLocaleString(), "Tokenized stocks listed on Solana"],
          [String(privateMarkets.length), "Private companies with issuer marks"],
          [
            money(tokenizedVolume, true) ?? "—",
            `24h volume across ${tradingStocks} traded stock tokens`,
          ],
          [
            overview?.sentiment ? `${overview.sentiment.score}/100` : "24/7",
            overview?.sentiment ? `Market mood · ${overview.sentiment.label}` : "Token pricing",
          ],
        ]
      : [
          ["6", "Market types in one terminal"],
          ["24/7", "Token prices beside the US session"],
          ["7", "Lifecycle stages for every agent"],
          ["0", "Agents that can place orders alone"],
        ];

  return (
    <main className="min-h-screen bg-ink-deep text-bone">
      <StructuredData data={[organizationSchema, websiteSchema, applicationSchema, faqSchema]} />
      <TickerTape identity={identity} />
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line">
        <Image
          src={ribbon}
          alt=""
          priority
          sizes="100vw"
          className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-[45%] object-cover object-left opacity-60 xl:block"
        />
        <div className="relative mx-auto grid max-w-[1320px] gap-14 px-4 pb-20 pt-16 md:px-8 md:pt-24 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:gap-12 xl:pt-20 xl:items-center">
          <div>
            <p className="eyebrow">Tokenized stocks · Pre-IPO · Crypto</p>
            <h1 className="display mt-6 text-[clamp(2.75rem,5vw,4.5rem)] leading-[0.98] text-bone">
              The research terminal for tokenized stocks and{" "}
              <span className="text-bronze-300">private markets.</span>
            </h1>
            <p className="mt-7 max-w-xl text-[17px] leading-8 text-slate-300">
              See the move, know the reason. The token, the underlying share, the private-company
              mark, the news, and your exposure, on one screen.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link
                href="/stocks"
                className="inline-flex items-center gap-2 bg-bronze-300 px-5 py-3.5 text-sm font-semibold text-ink hover:bg-bronze-200"
              >
                Open the terminal free <ArrowRight size={16} />
              </Link>
              <a
                href={site.tokenUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 border border-line-strong px-5 py-3.5 text-sm text-bone hover:border-bone"
              >
                Buy $Sisera <ArrowUpRight size={15} />
              </a>
            </div>
            <p className="mt-6 flex items-center gap-2 text-[13px] text-slate-300">
              <span className="size-1.5 bg-[var(--up)]" />
              Free to use. No subscription, no card. Browse every market without signing in.
            </p>
          </div>
          <Screen
            src={screenStock}
            alt="Sisera asset page for a tokenized stock: price, premium to the underlying share, chart, and order ticket"
            priority
          />
        </div>
      </section>

      {/* Proof band */}
      <section aria-label="Coverage" className="border-b border-line bg-ink">
        <dl className="mx-auto grid max-w-[1320px] grid-cols-2 lg:grid-cols-4">
          {proof.map(([value, label]) => (
            <div
              key={label}
              className="border-line px-4 py-8 odd:border-r md:px-8 lg:border-r lg:last:border-r-0"
            >
              <dt className="sr-only">{label}</dt>
              <dd className="display text-5xl text-bone">{value}</dd>
              <dd className="mt-2 text-[13px] text-slate-400">{label}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-line">
          <p className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-8 gap-y-2 px-4 py-5 font-mono text-[12px] text-slate-400 md:px-8">
            <span className="text-slate-300">Market data from</span>
            {site.dataSources.map((source) => (
              <span key={source}>{source}</span>
            ))}
          </p>
        </div>
      </section>

      {/* Markets */}
      <section id="markets" className="scroll-mt-16 border-b border-line">
        <Chapter
          image={candlesImage}
          align="left"
          eyebrow="Tokenized stocks"
          title="Every stock token, measured against the share it tracks."
          body="More than a thousand tokenized stocks are listed on Solana, and they trade when the shares do not. Sisera puts each token beside its underlying share price, second by second, and flags when the US market is closed and the gap is likely to be wide."
        />
        <div className="mx-auto grid max-w-[1320px] gap-12 px-4 py-20 md:px-8 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] lg:items-center">
          <div>
            <ul className="space-y-3 text-[14px] text-slate-300">
              {[
                "Premium or discount to the underlying share",
                "Liquidity and 24h volume before you size a trade",
                "Company news on the same page as the chart",
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="mt-2 size-1.5 shrink-0 bg-bronze-300" />
                  {item}
                </li>
              ))}
            </ul>
            {movers.length > 0 && (
              <div className="mt-10 border border-line bg-ink">
                <p className="border-b border-line px-4 py-3 data-label">Moving most · 24h</p>
                {movers.map((item) => (
                  <Link
                    key={item.mint}
                    href={`/stocks/${encodeURIComponent(item.symbol)}`}
                    className="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-[13px] last:border-0 hover:bg-white/[.03]"
                  >
                    <span className="text-bone">{item.symbol}</span>
                    <span className="flex gap-5">
                      <span className="text-slate-300">{money(item.dexPriceUsd)}</span>
                      <span className={`w-16 text-right ${signTone(item.change24hPct ?? 0)}`}>
                        {signedPct(item.change24hPct ?? 0)}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <Screen
            src={screenStocks}
            alt="Sisera tokenized stocks screener with prices, 24h change, volume, and liquidity"
          />
        </div>
      </section>

      {/* Private markets */}
      <section id="private" className="scroll-mt-16 border-b border-line bg-ink">
        <Chapter
          image={coinsImage}
          align="left"
          eyebrow="Private markets"
          title="Pre-IPO tokens, priced against the issuer's own mark."
          body="For private-company tokens, the number that matters is the gap between what the token trades at and what the issuer says the company is worth. Sisera shows both, the implied valuation, and the price history behind them."
        />
        <div className="mx-auto grid max-w-[1320px] gap-12 px-4 py-20 md:px-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,.8fr)] lg:items-center">
          <Screen
            src={screenPrivate}
            alt="Sisera private markets view comparing pre-IPO token prices with issuer marks"
          />
          <div className="lg:order-first xl:order-none">
            {privateGaps.length > 0 && (
              <div className="border border-line bg-ink-deep">
                <p className="border-b border-line px-4 py-3 data-label">Widest gaps to mark</p>
                {privateGaps.map((item) => (
                  <Link
                    key={item.instrument.id}
                    href={`/private-markets/${encodeURIComponent(item.instrument.baseAsset)}`}
                    className="flex items-center justify-between border-b border-line px-4 py-2.5 text-[13px] last:border-0 hover:bg-white/[.03]"
                  >
                    <span className="text-bone">{item.company}</span>
                    <span className={`font-mono ${signTone(Number(item.premiumDiscountPct))}`}>
                      {signedPct(Number(item.premiumDiscountPct))}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Intelligence */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-[1320px] px-4 py-24 md:px-8">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-end">
            <div>
              <p className="eyebrow">Intelligence</p>
              <h2 className="display mt-4 text-5xl leading-[1.02] text-bone">
                Ask why it moved before you ask whether to trade.
              </h2>
            </div>
            <p className="max-w-lg text-[15px] leading-7 text-slate-300 lg:justify-self-end">
              A price move next to company coverage, reference prices, market mood, and your own
              portfolio. Start with the evidence, then decide whether the trade still makes sense.
            </p>
          </div>
          <div className="mt-12">
            <Screen
              src={screenIntelligence}
              alt="Sisera intelligence view linking price moves to news and market context"
            />
          </div>
        </div>
      </section>

      {/* Agents */}
      <section id="agents" className="scroll-mt-16 border-b border-line bg-ink">
        <Chapter
          image={gatesImage}
          align="top"
          eyebrow="Agents"
          title="Seven gates between an idea and your capital."
          body="Start from a template, change the markets, rules, and limits, and save your own agent. Each one is a hashed policy with its limits declared up front; agents research and propose, and you decide."
        />
        <div className="mx-auto max-w-[1320px] px-4 py-20 md:px-8">
          <ol className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-7">
            {lifecycle.map(([stage, detail]) => (
              <li key={stage} className="flex flex-col bg-ink-deep p-5">
                <span className="text-[15px] font-semibold text-bone">{stage}</span>
                <span className="mt-2 text-[12px] leading-5 text-slate-400">{detail}</span>
              </li>
            ))}
          </ol>
        </div>
        <Chapter
          image={vaultImage}
          align="right"
          eyebrow="Safeguards"
          title="Limits you set, enforced before anything moves."
          body="Capital caps, drawdown limits, and a kill switch travel with every agent, and paper accounts let you rehearse a thesis before it costs anything."
        />
        <div className="mx-auto max-w-[1320px] px-4 py-20 md:px-8">
          <div className="grid gap-px border border-line bg-line md:grid-cols-2 xl:grid-cols-4">
            {safeguards.map(([title, detail]) => (
              <div key={title} className="bg-ink p-6">
                <p className="text-[15px] font-semibold text-bone">{title}</p>
                <p className="mt-3 text-[13px] leading-6 text-slate-400">{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ on a light band */}
      <section id="faq" className="scroll-mt-16 bg-bone text-ink">
        <div className="mx-auto grid max-w-[1320px] gap-12 px-4 py-24 md:px-8 lg:grid-cols-[.8fr_1.2fr]">
          <div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-bronze-600">
              Questions
            </p>
            <h2 className="display mt-4 text-5xl leading-[1.02]">What people ask first.</h2>
            <p className="mt-6 max-w-sm text-[15px] leading-7 text-[#3b4a53]">
              Still unsure? Read the{" "}
              <Link href="/risk-disclosure" className="underline underline-offset-4">
                risk disclosure
              </Link>{" "}
              or{" "}
              <Link href="/about" className="underline underline-offset-4">
                how Sisera works
              </Link>
              .
            </p>
          </div>
          <div className="border-t border-ink/15">
            {faqs.map((faq) => (
              <details key={faq.question} className="group border-b border-ink/15">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[17px] font-medium">
                  {faq.question}
                  <span className="font-mono text-lg text-bronze-600 group-open:rotate-45">+</span>
                </summary>
                <p className="max-w-2xl pb-6 text-[15px] leading-7 text-[#3b4a53]">{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing call to action */}
      <section className="border-b border-line">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-end justify-between gap-8 px-4 py-20 md:px-8">
          <h2 className="display max-w-3xl text-5xl leading-[1.02] text-bone">
            Follow the evidence all the way to the order.
          </h2>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/stocks"
              className="inline-flex items-center gap-2 bg-bronze-300 px-5 py-3.5 text-sm font-semibold text-ink hover:bg-bronze-200"
            >
              Open the terminal <ArrowRight size={16} />
            </Link>
            <Link
              href="/about"
              className="inline-flex items-center gap-2 border border-line-strong px-5 py-3.5 text-sm text-bone hover:border-bone"
            >
              About Sisera <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
