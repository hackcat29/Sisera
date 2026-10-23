import type { Metadata } from "next";
import Link from "next/link";
import { ContactLine, ProsePage } from "../../components/prose-page";
import { site } from "../../lib/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "What Sisera is, which markets it covers, where its data comes from, and how its research agents are governed.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <ProsePage
      eyebrow="About Sisera"
      title="One screen for the price, the reason, and the risk."
      intro="Sisera is a research and trading terminal for tokenized stocks, pre-IPO company tokens, and crypto markets. It exists because the numbers behind one decision are usually spread across five tabs."
      path="/about"
    >
      <h2>The problem</h2>
      <p>
        A stock token on Solana trades around the clock. The share it tracks trades on a US exchange
        schedule. A pre-IPO token trades against a valuation the issuer publishes. The news that
        moved any of them is somewhere else again, and your own exposure is in a wallet. Making one
        good decision means lining all of that up by hand.
      </p>
      <p>Sisera lines it up for you, then leaves the decision with you.</p>

      <h2>What you can do in the terminal</h2>
      <ul>
        <li>
          Compare each tokenized stock with the Pyth reference price for the underlying share and
          see the premium or discount, with a clear flag when the share market is closed.
        </li>
        <li>
          Compare pre-IPO tokens with the issuer's mark and implied valuation, and follow the price
          history behind the gap.
        </li>
        <li>
          Trade crypto spot and Hyperliquid perpetuals with charts and order book depth, and browse
          Panta prediction markets with wallet-signed live orders and an optional practice account.
        </li>
        <li>Read why a price moved, with company news and market context on the same page.</li>
        <li>See Solana and Hyperliquid holdings together, with exposure and shock tests.</li>
        <li>
          Draft research agents as policies with capital caps, drawdown limits, and a kill switch.
        </li>
      </ul>

      <h2>Where the data comes from</h2>
      <p>
        Sisera reads market data from {site.dataSources.join(", ")}, and company news from several
        news providers. Figures are shown with their source and update time. Data can be delayed,
        incomplete, or unavailable, and Sisera says so rather than filling gaps with estimates.
      </p>

      <h2>How agents are governed</h2>
      <p>
        An agent in Sisera is a declared policy: the markets it may look at, the factors it uses,
        and hard limits on capital, trade size, daily drawdown, open positions, stop-loss,
        take-profit, and slippage. The policy is hashed so any change is visible. Execution is set
        to proposal-only, so agents produce research and trade proposals and an operator decides
        what is placed.
      </p>
      <p>
        Each agent follows a seven-stage lifecycle: draft, backtest, stress test, paper, shadow,
        limited live, and live. The lifecycle sets out what an agent must pass before it could
        manage capital.
      </p>

      <h2>Open source & verified logic</h2>
      <p>
        Sisera is open source. The entire institutional terminal, autonomous agent runtime, and risk
        policies are hosted on GitHub at{" "}
        <a
          href={site.github}
          target="_blank"
          rel="noreferrer"
          className="text-bronze-300 underline underline-offset-4 hover:text-bronze-200"
        >
          {site.github.replace("https://github.com/", "")}
        </a>
        .
      </p>

      <h2>What Sisera is not</h2>
      <p>
        Sisera is not a broker, exchange, custodian, or investment adviser, and nothing in the
        terminal is a recommendation. Orders you place go to the venue you choose, from a wallet or
        account you control. Read the <Link href="/risk-disclosure">risk disclosure</Link> before
        trading.
      </p>
      <ContactLine />
    </ProsePage>
  );
}
