import { pool } from "./platform.js";

export async function saveThematicResearch(
  db: string,
  subject: string,
  id: string,
  report: unknown,
  hash: string,
  expiresAt: string,
) {
  await pool(db)`INSERT INTO thematic_research(id, subject, report, report_hash, expires_at)
    VALUES (${id}, ${subject}, ${JSON.stringify(report)}::text::jsonb, ${hash}, ${expiresAt})`;
}
export async function getThematicResearch(db: string, subject: string, id: string) {
  const [row] = await pool(db)`SELECT report, report_hash AS hash, expires_at AS "expiresAt"
    FROM thematic_research WHERE id = ${id} AND subject = ${subject}`;
  return row ?? null;
}
export async function listThematicResearch(db: string, subject: string) {
  return pool(db)`SELECT id, report, created_at AS "createdAt" FROM thematic_research
    WHERE subject = ${subject} ORDER BY created_at DESC LIMIT 30`;
}

export async function marketplaceEvidence(db: string, agentId: string, version: string) {
  const [fills, evaluations] = await Promise.all([
    pool(db)`SELECT a.id, a.mode, a.venue, a.instrument_key AS "instrumentKey", a.symbol, a.side,
      COALESCE(f.quantity, a.quantity)::float8 AS quantity, COALESCE(f.price_usd, a.price_usd)::float8 AS "priceUsd",
      COALESCE(f.fee_usd, a.fee_usd)::float8 AS "feeUsd", a.signature, a.occurred_at AS "occurredAt",
      (p.signature IS NOT NULL AND f.id IS NOT NULL) AS verified
      FROM agent_fills a
      LEFT JOIN LATERAL (SELECT * FROM portfolio_fills WHERE mode = 'live' AND source = 'solana_swap_orders'
        AND signature = a.signature AND instrument_key = a.instrument_key AND side = a.side
        AND tenant_id = a.tenant_id AND subject = a.subject AND book = 'agent:' || a.agent_id LIMIT 1) f ON a.mode = 'live'
      LEFT JOIN strategy_trade_proofs p ON p.signature = a.signature
      WHERE a.agent_id = ${agentId} AND a.manifest_version = ${version} ORDER BY a.occurred_at`,
    pool(db)`SELECT id, stage, outcome, manifest_hash AS "manifestHash", evidence,
      data_window_start AS "windowStart", data_window_end AS "windowEnd", recorded_at AS "recordedAt",
      reviewer_subject LIKE 'system:sisera-%' AS "engineRecorded"
      FROM agent_evaluations WHERE agent_id = ${agentId} AND manifest_version = ${version} ORDER BY recorded_at DESC`,
  ]);
  return { fills, evaluations };
}
export async function saveTradeProof(db: string, signature: string, slot: number) {
  await pool(
    db,
  )`INSERT INTO strategy_trade_proofs(signature, slot) VALUES (${signature}, ${slot}) ON CONFLICT DO NOTHING`;
}
export async function marketplaceReputation(db: string) {
  return pool(
    db,
  )`SELECT l.id, count(r.subject)::int AS "reviewCount", avg(r.rating)::float8 AS rating,
    (SELECT count(*)::int FROM strategy_licenses s WHERE s.listing_id = l.id) AS licenses
    FROM strategy_listings l LEFT JOIN strategy_reviews r ON r.listing_id = l.id GROUP BY l.id`;
}
export async function strategyReviews(db: string, id: string, subject: string) {
  return pool(db)`SELECT rating, comment, created_at AS "createdAt", updated_at AS "updatedAt",
    subject = ${subject} AS "isOwn" FROM strategy_reviews WHERE listing_id = ${id} ORDER BY updated_at DESC LIMIT 100`;
}
export async function saveStrategyReview(
  db: string,
  id: string,
  subject: string,
  rating: number,
  comment: string,
) {
  await pool(db)`INSERT INTO strategy_reviews(listing_id, subject, rating, comment)
    VALUES (${id}, ${subject}, ${rating}, ${comment}) ON CONFLICT(listing_id, subject)
    DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = now()`;
}
