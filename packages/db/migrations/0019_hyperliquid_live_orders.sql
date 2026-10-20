-- Live Hyperliquid perpetual orders. Sisera prepares and risk-checks each order, the user's
-- Hyperliquid trading key signs the exact actions, and Sisera submits them. The prepared actions
-- are stored so that only what passed the checks can be submitted.
ALTER TABLE market_live_orders DROP CONSTRAINT market_live_orders_status_check;
ALTER TABLE market_live_orders
  ADD CONSTRAINT market_live_orders_status_check
    CHECK (status IN ('prepared', 'submitting', 'open', 'filled', 'cancelled', 'rejected', 'unknown', 'expired')),
  ADD COLUMN account_address text CHECK (account_address ~ '^0x[0-9a-f]{40}$'),
  ADD COLUMN prepared_actions jsonb,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN leverage numeric CHECK (leverage > 0),
  ADD COLUMN margin_usd numeric CHECK (margin_usd > 0),
  ADD COLUMN reduce_only boolean NOT NULL DEFAULT false,
  ADD COLUMN market_type text NOT NULL DEFAULT 'perp' CHECK (market_type IN ('perp', 'spot')),
  ADD COLUMN order_type text NOT NULL DEFAULT 'market' CHECK (order_type IN ('market', 'limit')),
  ADD COLUMN limit_price numeric CHECK (limit_price > 0);

-- Deposits from Solana into Hyperliquid are built by Sisera and signed by the user. The unsigned
-- transaction is kept until it is submitted, so the signed copy can be checked against it.
ALTER TABLE bridge_transfers
  ADD COLUMN unsigned_transaction text,
  ADD COLUMN unsigned_expires_at timestamptz;

-- Hyperliquid spot fills are crypto spot holdings, not perpetual positions.
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
SELECT id::text, tenant_id, subject, mode, 'agent:' || agent_id, venue, asset_class, instrument_key, side,
  quantity, price_usd, fee_usd, arrival_price_usd, signature, 'agent_fills', occurred_at
FROM agent_fills;
