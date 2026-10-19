-- Swaps into USDC (book 'convert') turn deposited tokens into trading cash. Those tokens were
-- never bought through Sisera, so counting the swap as a sale would open a phantom short. They stay
-- in solana_swap_orders and the account event log for audit, but not in trading positions.
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
  CASE WHEN venue = 'hyperliquid' THEN 'perpetual' ELSE 'crypto_spot' END,
  venue || ':' || symbol, side, quantity, fill_price, COALESCE(fee_usd, 0), NULL, venue_order_id, 'market_live_orders', updated_at
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
