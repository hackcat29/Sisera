/** Public facts about Sisera shared by metadata, structured data, sitemap, and llms.txt. */
export const site = {
  name: "Sisera",
  url: "https://sisera.xyz",
  title: "Sisera — Free research terminal for tokenized stocks and private markets",
  shortDescription: "Free research terminal for tokenized stocks and private markets.",
  description:
    "Compare tokenized stocks with their underlying shares, pre-IPO tokens with issuer marks, and crypto markets in one terminal, with company news, portfolio context, and rule-bound research agents.",
  themeColor: "#0c141b",
  /** Canonical GitHub repository */
  github: "https://github.com/hackcat29/Sisera",
  /** $SISERA token page on pump.fun */
  tokenUrl: "https://pump.fun/coin/4eTknJyuvzcFNS9swypDsfYnhBFJ4d7VqZTqK21RYUh5",
  /** Public contact address shown on the about and legal pages. */
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "admin@sisera.xyz",
  /** Official profiles for Organization.sameAs. Add each account once it is live. */
  sameAs: ["https://github.com/hackcat29/Sisera"],
  /** Market data providers Sisera reads from; shown as plain text, never as partner logos. */
  dataSources: ["Pyth", "Panta", "Jupiter", "CoinMarketCap", "Hyperliquid", "Binance", "Helius"],
};

/** Public pages, in sitemap order. Market pages are public too and are listed separately. */
export const publicPages = [
  { path: "/", changeFrequency: "hourly", priority: 1 },
  { path: "/about", changeFrequency: "monthly", priority: 0.6 },
  { path: "/brand", changeFrequency: "monthly", priority: 0.3 },
  { path: "/risk-disclosure", changeFrequency: "yearly", priority: 0.4 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
] as const;

export const faqs = [
  {
    question: "Is Sisera free?",
    answer:
      "Yes. Sisera is free to use: every market, chart, and prediction research page is open without an account, and signing in to trade, keep a paper account, or build agents costs nothing. You only pay the network and venue fees on trades you place.",
  },
  {
    question: "What is Sisera?",
    answer:
      "Sisera is a research and trading terminal for tokenized stocks, pre-IPO company tokens, and crypto markets. It puts a token's price beside the underlying share or issuer mark, company news, and your portfolio so you can see why a price moved before you trade.",
  },
  {
    question: "What is a tokenized stock premium or discount?",
    answer:
      "It is the gap between a stock token's price on Solana and the latest price of the underlying share. Sisera compares the two using Pyth reference prices and flags when the share price is outside live market hours, because gaps widen when the exchange is closed.",
  },
  {
    question: "How does Sisera price private companies?",
    answer:
      "For pre-IPO tokens, Sisera compares the token price with the issuer's published mark and implied valuation, and shows the premium or discount between them. Private-company tokens can be thinly traded, so review liquidity and token rights before trading.",
  },
  {
    question: "Can Sisera agents trade on their own?",
    answer:
      "No. Sisera agents are drafted as policies with capital caps, drawdown limits, stop-loss and take-profit rules, and a kill switch. They produce research and proposals only; an operator decides whether any order is placed.",
  },
  {
    question: "Which markets does Sisera cover?",
    answer:
      "Tokenized US stocks on Solana, pre-IPO private-company tokens, crypto spot markets, Hyperliquid perpetuals, prediction markets, and macro and chain-level data.",
  },
  {
    question: "Is Sisera investment advice?",
    answer:
      "No. Sisera provides market data and research tools. Prices can be delayed or incomplete, tokens can trade away from their underlying assets, and you can lose money. Read the risk disclosure before trading.",
  },
] as const;
