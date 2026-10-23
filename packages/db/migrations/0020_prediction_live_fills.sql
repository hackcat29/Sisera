-- Live prediction market orders from Panta. Adds contract, price, and fee columns
-- and integrates live prediction fills into the unified portfolio view.
ALTER TABLE prediction_orders
  ADD COLUMN IF NOT EXISTS price_usd numeric CHECK (price_usd > 0),
  ADD COLUMN IF NOT EXISTS contracts numeric CHECK (contracts > 0),
  ADD COLUMN IF NOT EXISTS fee_usd numeric CHECK (fee_usd >= 0);

ALTER TABLE prediction_orders DROP CONSTRAINT IF EXISTS prediction_orders_status_check;
ALTER TABLE prediction_orders
  ADD CONSTRAINT prediction_orders_status_check
    CHECK (status IN ('prepared', 'submitting', 'submitted', 'confirmed', 'failed', 'unknown'));

-- Recreate portfolio_fills view to include live prediction fills.
CREATE OR REPLACE VIEW portfolio_fills AS
SELECT
  o.id::text AS id, o.tenant_id, o.subject, o.mode, o.book, 'solana' AS venue,
  NULL::text AS asset_class,
  CASE WHEN o.input_mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' THEN o.output_mint ELSE o.input_mint END AS instrument_key,
  CASE WHEN o.input_mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' THEN 'buy' ELSE 'sell' END AS side,
  CASE
    WHEN o.mode = 'paper' AND o.input_mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' THEN o.out_amount::numeric
    WHEN o.mode = 'paper' THEN o.in_amount::numeric
    WHEN o.input_mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' THEN o.out_amount::numeric / power(10::numeric, o.token_decimals)
    ELSE o.in_amount::numeric / power(10::numeric, o.token_decimals)
  END AS quantity,
  CASE
    WHEN o.mode = 'paper' AND o.input_mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' THEN o.in_amount::numeric / NULLIF(o.out_amount::numeric, 0)
    WHEN o.mode = 'paper' THEN o.out_amount::numeric / NULLIF(o.in_amount::numeric, 0)
    WHEN o.input_mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      THEN (o.in_amount::numeric / 1000000) / NULLIF(o.out_amount::numeric / power(10::numeric, o.token_decimals), 0)
    ELSE (o.out_amount::numeric / 1000000) / NULLIF(o.in_amount::numeric / power(10::numeric, o.token_decimals), 0)
  END AS price_usd,
  0::numeric AS fee_usd,
  o.arrival_price_usd,
  o.signature,
  'solana_swap_orders' AS source,
  o.updated_at AS occurred_at
FROM solana_swap_orders o
WHERE o.status IN ('paper_filled', 'confirmed') AND (o.mode = 'paper' OR o.token_decimals IS NOT NULL)
  AND o.book <> 'convert'
UNION ALL
SELECT id::text, tenant_id, subject, 'paper', 'manual', venue,
  CASE WHEN venue = 'hyperliquid' THEN 'perpetual' ELSE 'crypto_spot' END,
  venue || ':' || symbol, side, quantity, fill_price, fee_usd, fill_price, NULL, 'market_paper_orders', created_at
FROM market_paper_orders WHERE status = 'filled'
UNION ALL
SELECT id::text, tenant_id, subject, 'live', 'manual', venue,
  CASE WHEN venue = 'hyperliquid' AND market_type = 'perp' THEN 'perpetual' ELSE 'crypto_spot' END,
  CASE WHEN market_type = 'spot' THEN 'hyperliquid-spot:' || symbol ELSE venue || ':' || symbol END,
  side, quantity, fill_price, COALESCE(fee_usd, 0), NULL, venue_order_id, 'market_live_orders', updated_at
FROM market_live_orders WHERE status = 'filled' AND fill_price IS NOT NULL
UNION ALL
SELECT id::text, tenant_id, subject, 'paper', 'manual', 'jupiter-prediction', 'prediction',
  'prediction:' || market_id || ':' || outcome, 'buy', contracts, fill_price_usd, fee_usd, fill_price_usd, NULL,
  'prediction_paper_orders', created_at
FROM prediction_paper_orders
UNION ALL
SELECT
  id::text,
  tenant_id,
  subject,
  'live' AS mode,
  'manual' AS book,
  'panta-prediction' AS venue,
  'prediction' AS asset_class,
  'prediction:' || market_id || ':' || outcome AS instrument_key,
  'buy' AS side,
  COALESCE(contracts, (deposit_amount::numeric / 1000000) / NULLIF(COALESCE(price_usd, 0.5), 0)) AS quantity,
  COALESCE(price_usd, 0.5) AS price_usd,
  COALESCE(fee_usd, 0) AS fee_usd,
  COALESCE(price_usd, 0.5) AS arrival_price_usd,
  signature,
  'prediction_orders' AS source,
  updated_at AS occurred_at
FROM prediction_orders
WHERE status IN ('submitted', 'confirmed')
UNION ALL
SELECT id::text, tenant_id, subject, mode, 'agent:' || agent_id, venue, asset_class, instrument_key, side,
  quantity, price_usd, fee_usd, arrival_price_usd, signature, 'agent_fills', occurred_at
FROM agent_fills;
