-- Bridge transfers also record Relay swaps of any EVM token into USDC. A swap starts from a token
-- amount rather than USDC, so its origin is stored as the token, its decimals and the raw amount.
ALTER TABLE bridge_transfers
  ALTER COLUMN origin_amount_usdc DROP NOT NULL,
  ADD COLUMN origin_currency text CHECK (origin_currency ~ '^0x[0-9a-f]{40}$'),
  ADD COLUMN origin_symbol text CHECK (char_length(origin_symbol) <= 32),
  ADD COLUMN origin_decimals integer CHECK (origin_decimals BETWEEN 0 AND 36),
  ADD COLUMN origin_amount_raw numeric CHECK (origin_amount_raw > 0),
  ADD CONSTRAINT bridge_transfers_origin_amount CHECK (
    origin_amount_usdc IS NOT NULL
    OR (origin_currency IS NOT NULL AND origin_decimals IS NOT NULL AND origin_amount_raw IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION record_bridge_account_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  INSERT INTO account_events (tenant_id, subject, source, source_id, mode, status, detail)
  VALUES (
    NEW.tenant_id, NEW.subject, 'bridge_transfers', NEW.id, 'live', NEW.status,
    jsonb_strip_nulls(jsonb_build_object(
      'requestId', NEW.request_id, 'originChainId', NEW.origin_chain_id,
      'destinationChainId', NEW.destination_chain_id, 'recipient', NEW.recipient,
      'sourceTxHash', NEW.source_tx_hash, 'destinationTxHash', NEW.destination_tx_hash,
      'originCurrency', NEW.origin_currency, 'originSymbol', NEW.origin_symbol,
      'originAmountRaw', NEW.origin_amount_raw::text
    ))
  );
  RETURN NEW;
END;
$$;
