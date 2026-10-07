# Strategy marketplace and tracked-wallet rankings

The account navigation includes `/marketplace` and `/leaderboard`. The leaderboard has one view for live trades made or tracked in Sisera. Paper trades are excluded, including when an older link contains `?view=paper`.

## Strategy licenses

Creators publish an owned agent with executable rules, a category, a description, a public creator name, and a one-time price between 0 and 10,000 USDC. The payout address must be a Solana wallet currently linked to the creator's account. Each listing pins one immutable manifest version. Editing an agent does not change an existing listing; publish the new version separately.

Paid checkout prepares a mainnet Solana USDC transfer directly to the creator, including a unique checkout memo. The buyer signs in their wallet. The server rejects any change to the prepared transaction and issues a license only after successful finalization. The creator receives the full price; the buyer pays network fees, including creation of the creator's USDC account when necessary. Payment signatures are recorded before submission, duplicate checkouts are blocked, and finalization can be recovered from another browser. Free licenses require an authenticated account without a wallet payment.

The library imports the purchased rules as a new `draft` / `research` agent owned by the buyer. Capital caps and risk guardrails remain; creator wallet settings, runtime state, and promotion approvals are removed. All seven promotion stages still apply. A license grants access to inspect and customize the strategy template; it does not start trading, promise returns, or provide a subscription to future strategy versions. Creator studio shows paid USDC earnings and license counts, and allows unlisting. Existing license holders retain access to an unlisted version.

## Wallet universe and performance

A durable registry includes external wallets as well as account wallets. The board also includes recorded live fills across every Sisera account and venue, with anonymous trader identifiers for exchange accounts. Paper fills never enter the rankings. Solana wallet observations and the existing EVM/Hyperliquid wallet endpoints register addresses automatically. Users can also add any Solana or EVM address from the leaderboard. EVM addresses normalize to lowercase; Solana addresses remain case-sensitive. Account identifiers and wallet ownership claims are not published.

Migration `0015_marketplace_wallet_rankings.sql` backfills addresses from existing live Solana orders, token launches, prediction orders, and bridge records. Older read-only wallet lookups were not persisted by Sisera and cannot be reconstructed from those tables. New observations are persisted even when their market-data provider is unavailable.

The 24-hour, 7-day and 30-day boards rank gross realized P&L. Sisera’s live fill ledger establishes FIFO cost basis; perpetual fills support both long and short closing trades. Solana ledger fills merge with wallet history by transaction signature, avoiding duplicate counting across agent and swap records:

- **Solana:** Helius enhanced transaction history, up to 500 recent transactions. USDC-quoted swaps use FIFO cost basis. Purchases before the ranking window can establish basis for sales inside it. Failed transactions and duplicate signatures are excluded. Transfers and unsupported swaps invalidate affected token basis rather than producing artificial profit. Unknown basis, network fees, non-USDC quote assets and unrealized gains are excluded. Coverage measures the percentage of observed sells with fully matched basis; results are always labeled partial.
- **EVM:** Hyperliquid reports closed P&L for up to 2,000 recent fills. The board does not measure other EVM trading, funding, fees, or unrealized gains. Results are labeled reported/partial.

A wallet with missing data remains visible with no rank. The board does not replace unknown values with zero returns. A bounded batch refreshes on page requests, and the platform scheduler rotates through up to 20 stale wallets every 30 seconds. Observations older than five minutes are excluded from rankings until refreshed.

Provider references: [Helius enhanced wallet history](https://www.helius.dev/docs/api-reference/enhanced-transactions/gettransactionsbyaddress) and [Hyperliquid user fills](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint).

## Deployment and validation

Apply the repository migrations with `pnpm db:migrate` before deploying the updated API and web app. `DATABASE_URL` is required. `HELIUS_API_KEY` enables Solana performance; `HYPERLIQUID_BASE_URL` controls the EVM fill provider. `SISERA_SCHEDULER_ENABLED=true` enables ongoing background refresh. Wallet ownership uses the existing Privy configuration. Mainnet USDC payments use the configured `SOLANA_RPC_URL` (or existing Helius/mainnet fallback).

Run `pnpm --filter @sisera/api test -- test/marketplace.test.ts` for transaction binding and wallet-accounting tests. To include persistence and route integration tests, set `MARKETPLACE_TEST_DATABASE_URL` to an isolated, fully migrated test database. Those integration tests create fixtures; do not point them at production. Blockchain RPC responses are simulated; the tests do not move real funds.
