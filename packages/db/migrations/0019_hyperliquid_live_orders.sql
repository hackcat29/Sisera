-- Live Hyperliquid perpetual orders. Sisera prepares and risk-checks each order, the user's
-- Hyperliquid trading key signs the exact actions, and Sisera submits them. The prepared actions
-- are stored so that only what passed the checks can be submitted.
ALTER TABLE market_live_orders DROP CONSTRAINT market_live_orders_status_check;
ALTER TABLE market_live_orders
  ADD CONSTRAINT market_live_orders_status_check
    CHECK (status IN ('prepared', 'submitting', 'filled', 'rejected', 'unknown', 'expired')),
  ADD COLUMN account_address text CHECK (account_address ~ '^0x[0-9a-f]{40}$'),
  ADD COLUMN prepared_actions jsonb,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN leverage numeric CHECK (leverage > 0),
  ADD COLUMN margin_usd numeric CHECK (margin_usd > 0),
  ADD COLUMN reduce_only boolean NOT NULL DEFAULT false;

-- Deposits from Solana into Hyperliquid are built by Sisera and signed by the user. The unsigned
-- transaction is kept until it is submitted, so the signed copy can be checked against it.
ALTER TABLE bridge_transfers
  ADD COLUMN unsigned_transaction text,
  ADD COLUMN unsigned_expires_at timestamptz;
