-- Listings pin an immutable, sanitized strategy version; licenses never confer live authority.
CREATE TABLE strategy_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  agent_id text NOT NULL,
  manifest_version text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  category text NOT NULL CHECK (category IN ('trend', 'mean_reversion', 'arbitrage', 'event', 'other')),
  creator_name text NOT NULL,
  payout_wallet text NOT NULL,
  price_usdc numeric(12,2) NOT NULL CHECK (price_usdc BETWEEN 0 AND 10000),
  draft jsonb NOT NULL,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'unlisted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agent_id, manifest_version) REFERENCES agent_manifests(id, version),
  UNIQUE (agent_id, manifest_version)
);
CREATE TABLE strategy_checkouts (
  id uuid PRIMARY KEY,
  listing_id uuid NOT NULL REFERENCES strategy_listings(id),
  subject text NOT NULL,
  wallet text NOT NULL,
  price_usdc numeric(12,2) NOT NULL CHECK (price_usdc > 0),
  unsigned_transaction text NOT NULL,
  signature text UNIQUE,
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'submitted', 'confirmed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, subject)
);
CREATE TABLE strategy_licenses (
  listing_id uuid NOT NULL REFERENCES strategy_listings(id),
  subject text NOT NULL,
  checkout_id uuid UNIQUE REFERENCES strategy_checkouts(id),
  paid_usdc numeric(12,2) NOT NULL CHECK (paid_usdc >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (listing_id, subject)
);
CREATE TABLE tracked_wallets (
  address text PRIMARY KEY,
  chain text NOT NULL DEFAULT 'solana' CHECK (chain IN ('solana', 'evm')),
  first_tracked_at timestamptz NOT NULL DEFAULT now(),
  last_tracked_at timestamptz NOT NULL DEFAULT now(),
  performance jsonb,
  evaluated_at timestamptz
);
-- Include wallets previously observed through Sisera's trading and launch workflows.
INSERT INTO tracked_wallets (address)
SELECT DISTINCT wallet FROM solana_swap_orders WHERE mode = 'live' AND wallet NOT LIKE 'paper:%'
UNION SELECT DISTINCT wallet FROM token_launches
UNION SELECT DISTINCT wallet FROM prediction_orders
ON CONFLICT DO NOTHING;

INSERT INTO tracked_wallets (address, chain)
SELECT DISTINCT lower(origin_address), 'evm' FROM bridge_transfers
UNION SELECT DISTINCT lower(recipient), 'evm' FROM bridge_transfers
ON CONFLICT DO NOTHING;
