# Sisera AI Mobile (iOS & Android)

Institutional Trading and Intelligence Terminal for Tokenized Equities, PreStocks, and Autonomous Agents on Solana.

---

## Architecture & Isolation

The mobile application is completely decoupled from the web monorepo workspace to guarantee that web deployment workflows in GitHub Actions remain unaffected:

1. **Independent Directory (`mobile/`)**: Located at the root of the repository, outside `apps/` and `packages/` defined in `pnpm-workspace.yaml`.
2. **Dedicated Dependency Tree**: Maintains its own `package.json` with Expo SDK 52 and React Native 0.76.
3. **Ignored by Root Linter & CI**: Added to `biome.json` ignore list and `.gitignore`, ensuring `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` in `.github/workflows/deploy.yml` and `ci.yml` run cleanly.
4. **Live Backend Connectivity (Zero Mock Data)**: All asset catalogs, market telemetry, Pyth Hermes reference prices, SEC EDGAR events, and trading routes query the live Sisera backend (`https://sisera.xyz` or local API).

---

## Core Capabilities

- **Sisera AI Copilot (`IntelligenceScreen`)**: Real-time conversational intelligence connected to Pyth oracle pricing, SEC EDGAR filings, and pre-trade risk engine.
- **Tokenized Equities & PreStocks (`MarketsScreen`)**: Full coverage of Solana xStocks (NVDAx, AAPLx, TSLAx, MSFTx) and Pre-IPO markets (OpenAI, Anthropic, SpaceX, Neuralink) with live premium/discount spreads against external benchmarks.
- **Autonomous Agents Framework (`AgentsScreen`)**: Inspect and supervise persistent trading agent fleets following `AGENTS.md` and ADR-008. Monitors 7-stage promotion pipelines, capital allocations, daily drawdowns, and real-time kill-switches.
- **Unified Portfolio (`PortfolioScreen`)**: Multi-asset NAV, cash balances, unrealized and realized P&L, risk mandate guardrails, and stress scenario simulations.
- **Clawpump & Meteora DBC (`ClawpumpScreen`)**: Stock-paired agent tokens, holder concentration metrics, risk scores, and Meteora Dynamic Bonding Curves.
- **Pre-Trade Risk Aware Order Ticket (`TradeModal`)**: Validates orders against institutional mandate limits prior to submission.

---

## Getting Started

### Prerequisites
- Node.js >= 20
- npm or pnpm
- Expo Go app on iOS or Android (or iOS Simulator / Android Studio)

### Installation
```bash
cd mobile
npm install
```

### Run Locally
```bash
# Start Expo development server
npm start

# Run on iOS Simulator
npm run ios

# Run on Android Emulator
npm run android

# Typecheck
npm run typecheck
```

### Native Builds (EAS)
```bash
# Preview build for iOS Simulator
npx eas-cli build -p ios --profile preview

# Preview build for Android (APK)
npx eas-cli build -p android --profile preview

# Production App Store / Google Play bundles
npx eas-cli build -p ios --profile production
npx eas-cli build -p android --profile production
```
