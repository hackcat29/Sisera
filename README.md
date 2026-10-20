# Sisera

**The trading and intelligence terminal for tokenized equities, private markets and autonomous agents on Solana.**

Sisera gives traders one place to discover stock-linked markets, understand what is moving them, compare onchain prices with reference values, execute, manage a single portfolio, and deploy agents that trade continuously inside explicit capital and risk limits. Tokenized stocks are treated as financial instruments, not as SPL tokens with a chart and a swap button: every market carries reference pricing, valuation context, liquidity analysis, portfolio exposure, execution quality, classified news and events, and an auditable history of how both humans and agents acted on it.

Live at **[sisera.xyz](https://sisera.xyz)** · Documentation at **[docs.sisera.xyz](https://docs.sisera.xyz)** · Repository on **[GitHub](https://github.com/hackcat29/Sisera)**.

[![DEX Screener Enhanced Token Info Paid](https://img.shields.io/badge/DEX_Screener-Enhanced_Token_Info_Paid-10B981?style=for-the-badge&logo=chart&logoColor=white)](https://dexscreener.com/solana/4eTknJyuvzcFNS9swypDsfYnhBFJ4d7VqZTqK21RYUh5)
[![Solana CA](https://img.shields.io/badge/Solana_CA-4eTkn...Uh5-14F195?style=for-the-badge&logo=solana&logoColor=black)](https://dexscreener.com/solana/4eTknJyuvzcFNS9swypDsfYnhBFJ4d7VqZTqK21RYUh5)

---

## $SISERA Token & How to Buy

> **Official Solana Contract Address (CA):**  
> `4eTknJyuvzcFNS9swypDsfYnhBFJ4d7VqZTqK21RYUh5`  
> *(Tap or copy the address above. Always verify against official channels before transacting).*

✨ **Verified Listing:** DEX Screener Enhanced Token Info has been officially paid for and verified by the Sisera project team.

### How to Buy

1. **Set Up a Solana Wallet:** Install a trusted Solana wallet such as [Phantom](https://phantom.app/), [Solflare](https://solflare.com/), or [Backpack](https://backpack.app/).
2. **Fund Wallet with SOL:** Deposit SOL into your wallet from an exchange or onchain transfer to cover the purchase and minimal Solana network fees.
3. **Swap for $SISERA:** Connect your wallet to any of the official venues below and swap SOL for `$SISERA` using the official CA:
   - **[Pump.fun](https://pump.fun/coin/4eTknJyuvzcFNS9swypDsfYnhBFJ4d7VqZTqK21RYUh5)**
   - **[FOMO](https://fomo.family/token/4eTknJyuvzcFNS9swypDsfYnhBFJ4d7VqZTqK21RYUh5)**
   - **[Clawpump](https://clawpump.tech/tokens/4eTknJyuvzcFNS9swypDsfYnhBFJ4d7VqZTqK21RYUh5)**
   - **[DEX Screener Live Chart](https://dexscreener.com/solana/4eTknJyuvzcFNS9swypDsfYnhBFJ4d7VqZTqK21RYUh5)**

🔒 **Security Reminder:** Sisera is strictly non-custodial. Team members and admins will **never** direct message you first, ask for your private keys, or send unverified transaction links.

### Tokenomics & Distribution Schedule

`$SISERA` was launched via a 100% fair launch on Solana (`Pump.fun` / `PumpSwap`) with zero presale, zero private VC rounds, and permanently revoked mint and freeze authorities (`mintAuthority: null`, `freezeAuthority: null`).

| Parameter / Category | Details |
| --- | --- |
| **Token Name & Ticker** | `Sisera` (`SISERA`) |
| **Network & Decimals** | Solana Mainnet (`6` decimals) |
| **Contract Address (Mint)** | `4eTknJyuvzcFNS9swypDsfYnhBFJ4d7VqZTqK21RYUh5` |
| **Initial Genesis Supply** | `1,000,000,000 SISERA` |
| **Current Total & Circulating Supply** | `945,060,456.354228 SISERA` (**100% Unlocked & Circulating**) |
| **Permanently Burned Supply** | `54,939,543.645772 SISERA` (**5.49% Burned**) |
| **Presale / VC / Team Unlocks** | `0%` (No future emissions, cliffs, or vesting unlocks) |
| **Top Holders Explorer** | [Solscan Holders](https://solscan.io/token/4eTknJyuvzcFNS9swypDsfYnhBFJ4d7VqZTqK21RYUh5#holders) |

---

## What Sisera does

### Intelligence that understands more than the chart

Sisera's intelligence layer continuously follows the information most likely to move each asset: earnings and guidance, fundraising, M&A, executive changes, lawsuits, regulatory and government actions, macro releases, rates, security incidents, listings, social chatter and emerging rumors.

- **Sources:** SEC EDGAR filings (8-K item codes, 10-Q, 10-K, S-1, 13D and more), GDELT, Google News and Bing News, Marketaux, GNews, Finnhub, macro news streams, Telegram, Reddit, X and Discord.
- **Classification:** every item is scored for source tier (regulatory filing, issuer announcement, wire, tier-1 press, press, aggregator, social), category, severity, sentiment and rumor language, then mapped onto the assets it concerns.
- **Corroboration:** related reports are clustered into events. An event is *confirmed* only by a filing or issuer announcement, *corroborated* only by independent established publishers, and a rumor is never shown with the certainty of a filing.
- **Answers:** *"Why is this asset moving?"*, *"What changed in the last hour?"*, *"Which of my positions are exposed to this event?"* and *"Which tokenized stocks trade furthest from fair value?"* are first-class queries in the terminal and in Sisera AI.

### Reference and fair-value layer

Every tokenized public equity is compared with its underlying share, measuring premium or discount, reference freshness, session effects and dislocations between the 24/7 Solana token and its exchange-listed share. Sisera integrates **Pyth** Core equity feeds through Hermes, with a public equity quote fallback; these values feed the opportunity screens, risk controls, alerts, portfolio valuation, agent rules and conversational policies. Every value carries its source and freshness, and a stale reference is shown as stale.

### Private markets with PreStocks

**PreStocks** is Sisera's dedicated pre-IPO layer. OpenAI, Anthropic, SpaceX, Neuralink, Kalshi, Anduril, Figure AI, Polymarket and every other supported PreStocks market sit in the same terminal as public equities, with live token price, issuer mark, implied versus mark valuation, liquidity, momentum, price history, classified company events, AI research and portfolio exposure. Markets can be ranked by gap to mark, deepest discount, highest premium, liquidity, momentum, risk, news intensity or **fit with your current portfolio**, and traded directly from the ranking.

### AI intelligence becomes executable

Sisera AI is connected to market data, the event engine, your portfolio, the risk engine and the order system. A trader can move naturally from:

> *"Why is OpenAI trading 8% above its mark?"* → *"Show me the strongest argument for and against buying it."* → *"What happens if I allocate $5,000?"* → *"Buy $2,000 if the premium falls below 3%, liquidity remains above my threshold, and no high-severity negative event appears."*

The last instruction becomes a **structured trading policy**, never a free-form model action. Sisera's deterministic compiler resolves the instrument, triggers, allocation, expiry, slippage, invalidation conditions and portfolio limits; the policy is validated against your mandate and shown with its live condition status and portfolio impact before you arm it. Armed policies are re-evaluated every 30 seconds and execute only through Sisera's pre-trade risk engine. A language model may rephrase a request into the policy grammar, but it never produces the policy, never signs and never places an order.

### Agentic trading with institutional governance

Any strategy can become a persistent agent that monitors markets around the clock using the same technical, valuation, event, liquidity and portfolio intelligence available to a human trader.

- **Declarative manifests:** universe, timeframe, executable entry and exit rules, capital cap, per-trade cap, stop, target, daily drawdown, open-position limit and slippage budget, hashed and immutable. Any change is a new version that restarts evaluation.
- **Autonomy levels:** research, suggest, confirm (you approve each order), policy-auto, autonomous, and risk-only (may only reduce exposure).
- **Seven-stage promotion pipeline:** Draft → Backtest (5+ years, Sharpe above 1.8, max drawdown below 10%) → Stress test (flash crash, gap, liquidity freeze, quote de-peg) → Paper (14+ days) → Shadow (live executable quotes) → Limited live (≤10% of capital) → Live. Each promotion requires recorded evidence for the exact manifest version, enforced by the database itself. Live stages need an independent risk manager.
- **Circuit breakers:** daily drawdown breaches pause the agent, implementation shortfall above 3× expectation demotes it to paper, and market data degraded for more than five seconds pauses it.
- **Decision trail:** every tick records what the agent observed, which rules passed, what it decided and what the risk engine said. Proposals, fills and slippage are attributed to the agent's own book.

### Clawpump: an entire agent market inside Sisera

**Clawpump** is integrated as both an asset universe and agent-launch infrastructure.

- Every Clawpump token is discoverable and tradable in Sisera, with live pricing, liquidity, onchain **holder concentration** (pools, curves and lockers separated from wallets), creator allocation and vesting, a transparent **risk score**, classified events and portfolio impact.
- Ask *"Which Clawpump agents are outperforming their paired stock?"*, *"Which agent tokens have the strongest liquidity and lowest holder concentration?"* or *"What changed in this agent market today?"* and trade from the answer.
- **Launch your agent as an asset:** Sisera creates the agent's Clawpump identity and launches its token on Pump.fun with a **stock pair** such as NVDAx, AAPLx or TSLAx and a custom creator fee. The creator's wallet pays the quoted launch cost directly; the launch is idempotent on the payment signature and resumable.

### Meteora DBC: stock-aware launch and liquidity

**Meteora Dynamic Bonding Curve** is built into the launch workflow with curves designed for assets that have external reference values:

- **Reference-anchored:** a narrow curve with a decaying anti-sniper fee and dynamic fees, for tokens meant to track a stock or known value.
- **Open price discovery:** a wider curve with a linear fee schedule.
- **Agent treasury:** locks 10% of supply for the agent treasury, vesting over 180 days after graduation.

Quote a curve in SOL, USDC or **a tokenized stock**, so the market is natively priced in the stock. Sisera previews the curve, price ladder and graduation threshold, builds and **simulates** both transactions, and the creator signs. After launch, Sisera monitors curve position, graduation progress into Meteora DAMM v2, liquidity, volume, price relative to the paired stock and fee accrual.

### One portfolio across human and autonomous markets

Every trade (manual, policy-driven or agent-driven, paper or live) flows into one immutable fill ledger. The unified portfolio rebuilds positions with average-cost accounting and shows:

- NAV, cash, realized and unrealized P&L, fees and estimated daily P&L
- exposure by asset class, sector, venue and **underlying economic exposure**, flagging duplicates (for example AAPLx plus an agent token paired to AAPL)
- concentration (largest weight, top 3, effective positions) and exit liquidity as a share of each pool
- five stress scenarios (equity sell-off, private mark reset, crypto flash crash, liquidity freeze, weekend gap)
- agent allocations and each agent's equity and P&L
- live reconciliation of the ledger against onchain wallet balances, with breaks listed explicitly

The portfolio is part of the intelligence loop. Before any policy or agent order executes, Sisera measures its effect on concentration, duplicated exposure, sector weight, cash and liquidity, and blocks orders that would breach your mandate.

### Strategy marketplace and wallet discovery

The **Marketplace** lets creators publish a fixed version of a strategy, sell a one-time USDC license, and track earnings paid directly to their wallet. Buyers can add free strategies or purchase access, then import the rules into a new research draft with Sisera’s normal promotion and risk checks.

The **Leaderboard** includes every persisted tracked Solana and EVM wallet, including external wallets whose owners have no Sisera account, alongside all recorded live trades made through Sisera. Time filters compare realized performance; incomplete results are marked partial, and unmeasured wallets remain visible without a rank. Paper trades are excluded. See [setup, accounting limits and validation](MARKETPLACE.md).

### And the rest of the terminal

Public xStocks and private markets, Binance spot, Hyperliquid perpetuals, Jupiter prediction markets, macro regime and chain data, social feeds, bridging into HyperEVM/HyperCore, paper and live trading tickets, activity timeline, alerts, leaderboard and account settings.

---

## Why Solana

Tokenized markets become far more useful when the stock, the liquidity, the wallet, the trading agent and the applications around them share one network. **PreStocks** brings permissionless private-market exposure, **Pyth** anchors reference values, **Clawpump** turns agents into launchable, tradable assets, **Meteora DBC** forms programmable stock-paired markets, and **Solana** settles and composes all of them.

---

## Safety model

- **Sisera never holds user keys.** Live swaps, policy executions, agent proposals and launches are built and risk-checked server-side and signed in the user's wallet. Signed bytes are verified against exactly what Sisera prepared before submission.
- **Language models cannot trade.** They narrate evidence and rephrase requests; policies are compiled and evaluated deterministically.
- **Fail closed.** A condition with missing data never passes, unpriced positions are excluded from NAV and labelled, and providers that fail return explicit unavailable states instead of invented values.
- **Live capabilities are feature-flagged** server-side. Venue, launch, agent and delegated-signing flags default to on and can be set to `false` to pause them; delegated signing also needs `PRIVY_AUTHORIZATION_PRIVATE_KEY`. Automatic live execution additionally requires the wallet owner to delegate a Privy session signer.
- **Audit by construction:** manifests, evaluations, agent decisions, fills and account events are append-only; activated policies cannot be edited, and agent promotions are enforced by database triggers.

---

## Architecture

A pnpm/Turborepo TypeScript monorepo.

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js 15 terminal: markets, Sisera AI, agents, launch studio, portfolio, risk, activity |
| `apps/api` | Fastify control plane: Privy auth and RBAC, market adapters, trading, platform services and scheduler |
| `apps/api/src/platform` | Asset catalog, intelligence service, SEC EDGAR, policy service, copilot, portfolio service, agent service, agent market analytics, rankings, Meteora DBC, launch orchestration, scheduler |
| `packages/intelligence` | News classification, corroboration, event clustering, move explanation |
| `packages/policy` | Condition language, natural-language policy compiler, deterministic evaluator |
| `packages/agent-runtime` | Strategy rules, backtester, stress tests, promotion gates, circuit breakers, autonomy dispositions |
| `packages/portfolio` | Position book from fills, valuation, exposures, trade impact, scenarios, reconciliation |
| `packages/risk` | Pre-trade risk and mandate utilization |
| `packages/market-data` | Binance, Hyperliquid, Jupiter predictions, PreStocks, Pyth Core, FRED, DeFiLlama |
| `packages/db` | PostgreSQL schema, migrations and data access |
| `packages/copilot`, `domain`, `oms`, `quant`, `ui` | Research clients, shared types, order state machine, indicators, UI primitives |

Background loops in the API evaluate armed policies every 30 seconds, run agents every 60 seconds and refresh the event watchlist every 15 minutes. Each loop holds a PostgreSQL advisory lock, so only one instance runs it.

---

## Quick start

```bash
cp -n .env.example .env
pnpm install
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3000`; the API runs on `http://localhost:4000`. `pnpm dev` loads `.env`, keeps existing values and supplies local-only operator defaults, so the terminal opens without Privy credentials. Set `SISERA_LOCAL_OPERATOR_MODE=false` and `SISERA_ALLOW_DEV_AUTH=false` to test real sign-in; neither may be enabled in a deployment.

### Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL for accounts, ledger, policies, agents, launches and events |
| `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | Sign-in (same app ID in web and API) |
| `HELIUS_API_KEY` / `SOLANA_RPC_URL` | Wallets, reconciliation, holder concentration, DBC and launch transactions |
| `JUPITER_API_KEY` | Live prices, swap orders, Swap to USDC and prediction markets |
| `SISERA_SWAP_MAX_USD` | Largest single Swap to USDC, in USD (default `10000`) |
| `SISERA_EVM_RPC_URLS` | Optional private RPCs for EVM swap balances, as `chainId=url` pairs (public RPCs by default) |
| `SISERA_LIVE_HYPERLIQUID_ENABLED` | Live Hyperliquid perps and spot trading (default `true`) |
| `SISERA_PERP_MAX_LEVERAGE` / `SISERA_PERP_MAX_NOTIONAL_USD` | Perp order limits (defaults `20`x and `25000`) |
| `SISERA_BUILDER_ADDRESS` | Wallet receiving Hyperliquid builder fees (`SISERA_BUILDER_FEE_PERP_BPS`, default 10; `SISERA_BUILDER_FEE_SPOT_BPS`, default 100) |
| `SISERA_JUPITER_REFERRAL_ACCOUNT` | Jupiter referral account for fees on Solana trades (`SISERA_JUPITER_TRADE_FEE_BPS`, default 100) and Swap to USDC (`SISERA_JUPITER_CONVERT_FEE_BPS`, default 50) |
| `SISERA_RELAY_FEE_RECIPIENT` | Relay app-fee recipient for EVM swaps (`SISERA_RELAY_SWAP_FEE_BPS`, default 50) and USDC bridges (`SISERA_RELAY_BRIDGE_FEE_BPS`, default 0) |
| `SISERA_SOLANA_FEE_ACCOUNT` | Sisera's USDC token account for prediction fees (`SISERA_PREDICTION_FEE_BPS`, default 100) |
| `PYTH_API_KEY`, `PYTH_HERMES_URL` | Pyth Core equity reference feeds |
| `CLAWPUMP_API_KEY` | Clawpump partner API (pairs, agents, launches) |
| `OPENROUTER_API_KEY`, `SISERA_INTELLIGENCE_MODEL` | Model narration for Sisera AI and research |
| `COINMARKETCAP_API_KEY`, `MARKETAUX_API_KEY`, `GNEWS_API_KEY`, `FINNHUB_API_KEY` | Market breadth and extra news coverage |
| `SEC_EDGAR_USER_AGENT` | Contact string SEC EDGAR requires from clients |
| `SISERA_LIVE_SOLANA_ENABLED`, `SISERA_LIVE_PREDICTIONS_ENABLED`, `SISERA_LIVE_BINANCE_ENABLED` | Live trading per venue |
| `SISERA_LIVE_LAUNCHES_ENABLED` | Clawpump and Meteora DBC launches |
| `SISERA_LIVE_AGENTS_ENABLED` | Limited-live and live agent stages |
| `SISERA_DELEGATED_SIGNING_ENABLED`, `PRIVY_AUTHORIZATION_PRIVATE_KEY` | Automatic live execution for delegated wallets |
| `SISERA_DBC_PARTNER_WALLET` | Optional recipient of Meteora DBC partner fees |
| `SISERA_SCHEDULER_ENABLED` | Background policy, agent and event loops (default on) |

Server credentials never reach the browser. See `.env.example` and `infra/.env.production.example`.

---

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`:

1. **Validate:** fresh PostgreSQL migrations, lint, typecheck, unit and integration tests, full build, account-persistence checks.
2. **Deploy:** over SSH to the VPS it syncs provider secrets and feature flags from GitHub Actions secrets into `/opt/sisera/.env.production`, takes a `pg_dump` backup, applies migrations, builds the API and a candidate web bundle, swaps bundles, restarts the systemd services (API on 4200, web on 3100 behind Nginx), and verifies both the local server and `SISERA_PUBLIC_URL`.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Further reading: `AGENTS.md` (agent governance), `docs/architecture.md`, `docs/security.md`, `docs/operations.md`, `docs/market-data.md`.

## Roadmap

- **Sisera Mobile** for Solana Mobile (Seeker), Android and iOS: positions, agents, alerts, policy approvals and intelligence away from the desk. Coming soon.

