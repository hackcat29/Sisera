import { pool } from "./platform.js";

export type StrategyListing = {
  id: string;
  subject: string;
  agentId: string;
  manifestVersion: string;
  title: string;
  description: string;
  category: string;
  creatorName: string;
  payoutWallet: string;
  priceUsdc: number;
  draft: unknown;
  status: string;
  createdAt: string;
};
const listing = (r: Record<string, unknown>): StrategyListing => ({
  id: String(r.id),
  subject: String(r.subject),
  agentId: String(r.agent_id),
  manifestVersion: String(r.manifest_version),
  title: String(r.title),
  description: String(r.description),
  category: String(r.category),
  creatorName: String(r.creator_name),
  payoutWallet: String(r.payout_wallet),
  priceUsdc: Number(r.price_usdc),
  draft: r.draft,
  status: String(r.status),
  createdAt: String(r.created_at),
});
export async function listStrategyListings(db: string) {
  return (await pool(db)`SELECT * FROM strategy_listings ORDER BY created_at DESC`).map(listing);
}
export async function getStrategyListing(db: string, id: string) {
  const [row] = await pool(db)`SELECT * FROM strategy_listings WHERE id = ${id}`;
  return row ? listing(row) : null;
}
export async function publishStrategy(
  db: string,
  input: Omit<StrategyListing, "id" | "status" | "createdAt">,
) {
  const [row] = await pool(db)`INSERT INTO strategy_listings
    (subject, agent_id, manifest_version, title, description, category, creator_name, payout_wallet, price_usdc, draft)
    VALUES (${input.subject}, ${input.agentId}, ${input.manifestVersion}, ${input.title}, ${input.description},
      ${input.category}, ${input.creatorName}, ${input.payoutWallet}, ${input.priceUsdc}, ${JSON.stringify(input.draft)}::text::jsonb)
    ON CONFLICT (agent_id, manifest_version) DO NOTHING RETURNING *`;
  return row ? listing(row) : null;
}
export async function unlistStrategy(db: string, id: string, subject: string) {
  return (
    (
      await pool(
        db,
      )`UPDATE strategy_listings SET status = 'unlisted' WHERE id = ${id} AND subject = ${subject} RETURNING id`
    ).length > 0
  );
}
export async function listStrategyLicenses(db: string, subject: string) {
  return pool(
    db,
  )`SELECT listing_id AS "listingId", paid_usdc::float8 AS "paidUsdc" FROM strategy_licenses WHERE subject = ${subject}`;
}
export async function grantFreeLicense(db: string, id: string, subject: string) {
  await pool(db)`INSERT INTO strategy_licenses (listing_id, subject, paid_usdc)
    SELECT id, ${subject}, 0 FROM strategy_listings WHERE id = ${id} AND price_usdc = 0 AND status = 'published'
    ON CONFLICT DO NOTHING`;
}
export async function strategySales(db: string, subject: string) {
  return pool(
    db,
  )`SELECT l.id, count(s.subject)::int AS sales, COALESCE(sum(s.paid_usdc), 0)::float8 AS "earnedUsdc"
    FROM strategy_listings l LEFT JOIN strategy_licenses s ON s.listing_id = l.id
    WHERE l.subject = ${subject} GROUP BY l.id`;
}
export async function saveStrategyCheckout(
  db: string,
  c: {
    id: string;
    listingId: string;
    subject: string;
    wallet: string;
    priceUsdc: number;
    transaction: string;
  },
) {
  const [row] = await pool(
    db,
  )`INSERT INTO strategy_checkouts (id, listing_id, subject, wallet, price_usdc, unsigned_transaction)
    VALUES (${c.id}, ${c.listingId}, ${c.subject}, ${c.wallet}, ${c.priceUsdc}, ${c.transaction})
    ON CONFLICT (listing_id, subject) DO UPDATE SET id = EXCLUDED.id, wallet = EXCLUDED.wallet,
      price_usdc = EXCLUDED.price_usdc, unsigned_transaction = EXCLUDED.unsigned_transaction, signature = NULL, status = 'prepared', created_at = now()
    WHERE strategy_checkouts.status = 'failed' OR (strategy_checkouts.signature IS NULL AND strategy_checkouts.created_at < now() - interval '5 minutes')
    RETURNING id`;
  return row ? String(row.id) : null;
}
export async function getStrategyCheckout(db: string, id: string, subject: string) {
  const [row] = await pool(
    db,
  )`SELECT * FROM strategy_checkouts WHERE id = ${id} AND subject = ${subject}`;
  return row ?? null;
}
export async function fulfillStrategyCheckout(
  db: string,
  id: string,
  subject: string,
  signature: string,
) {
  await pool(db).begin(async (sql) => {
    const [c] =
      await sql`SELECT * FROM strategy_checkouts WHERE id = ${id} AND subject = ${subject} FOR UPDATE`;
    if (!c || (c.signature && c.signature !== signature))
      throw new Error("Checkout already settled.");
    await sql`UPDATE strategy_checkouts SET signature = ${signature}, status = 'confirmed' WHERE id = ${id}`;
    await sql`INSERT INTO strategy_licenses (listing_id, subject, checkout_id, paid_usdc)
      VALUES (${c.listing_id}, ${subject}, ${id}, ${c.price_usdc}) ON CONFLICT (listing_id, subject) DO NOTHING`;
  });
}
export async function trackWallet(db: string, address: string) {
  const chain = address.startsWith("0x") ? "evm" : "solana";
  const normalized = chain === "evm" ? address.toLowerCase() : address;
  await pool(
    db,
  )`INSERT INTO tracked_wallets (address, chain) VALUES (${normalized}, ${chain}) ON CONFLICT (address)
    DO UPDATE SET last_tracked_at = now()`;
}
export async function listTrackedWallets(db: string) {
  return pool(
    db,
  )`SELECT address, chain, performance, evaluated_at AS "evaluatedAt" FROM tracked_wallets ORDER BY evaluated_at ASC NULLS FIRST, address`;
}
export async function saveWalletPerformance(db: string, address: string, performance: unknown) {
  await pool(
    db,
  )`UPDATE tracked_wallets SET performance = ${JSON.stringify(performance)}::text::jsonb, evaluated_at = now() WHERE address = ${address}`;
}

export async function markStrategyPayment(
  db: string,
  id: string,
  subject: string,
  signature: string,
) {
  const rows = await pool(
    db,
  )`UPDATE strategy_checkouts SET signature = ${signature}, status = CASE WHEN status = 'confirmed' THEN status ELSE 'submitted' END
    WHERE id = ${id} AND subject = ${subject} AND status <> 'failed' AND (signature IS NULL OR signature = ${signature}) RETURNING id`;
  return rows.length > 0;
}

export async function failStrategyCheckout(db: string, id: string, subject: string) {
  await pool(
    db,
  )`UPDATE strategy_checkouts SET status = 'failed' WHERE id = ${id} AND subject = ${subject} AND status <> 'confirmed'`;
}
export async function pendingStrategyCheckouts(db: string, subject: string) {
  return pool(db)`SELECT id, listing_id AS "listingId" FROM strategy_checkouts
    WHERE subject = ${subject} AND status = 'submitted' ORDER BY created_at DESC`;
}

/** Live fills across every account. Trade identity is projected to a pseudonym before publication. */
export async function listLeaderboardLiveFills(db: string) {
  return pool(db)`SELECT f.id, f.subject, f.tenant_id AS "tenantId", f.venue,
    f.instrument_key AS "instrumentKey", f.side, f.quantity::float8 AS quantity,
    f.price_usd::float8 AS "priceUsd", f.signature, f.occurred_at AS "occurredAt",
    COALESCE(o.wallet, m.policy->'execution'->>'liveWallet') AS wallet
    FROM portfolio_fills f
    LEFT JOIN solana_swap_orders o ON f.source = 'solana_swap_orders' AND f.id = o.id::text
    LEFT JOIN agent_fills a ON f.source = 'agent_fills' AND f.id = a.id::text
    LEFT JOIN agent_manifests m ON a.agent_id = m.id AND a.manifest_version = m.version
    WHERE f.mode = 'live' AND f.quantity > 0 AND f.price_usd > 0
    ORDER BY f.occurred_at DESC`;
}
