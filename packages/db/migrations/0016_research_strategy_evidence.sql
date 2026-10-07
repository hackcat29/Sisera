CREATE TABLE thematic_research (
  id text PRIMARY KEY,
  subject text NOT NULL,
  report jsonb NOT NULL,
  report_hash text NOT NULL CHECK (report_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX thematic_research_subject_idx ON thematic_research(subject, created_at DESC);
CREATE TRIGGER thematic_research_immutable BEFORE UPDATE OR DELETE ON thematic_research
FOR EACH ROW EXECUTE FUNCTION account_events_immutable();

CREATE TABLE strategy_reviews (
  listing_id uuid NOT NULL REFERENCES strategy_listings(id),
  subject text NOT NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL CHECK (length(comment) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(listing_id, subject)
);
CREATE FUNCTION guard_strategy_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM strategy_licenses WHERE listing_id = NEW.listing_id AND subject = NEW.subject)
    OR EXISTS (SELECT 1 FROM strategy_listings WHERE id = NEW.listing_id AND subject = NEW.subject) THEN
    RAISE EXCEPTION 'Only licensed buyers may review a strategy';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER strategy_review_license BEFORE INSERT OR UPDATE ON strategy_reviews
FOR EACH ROW EXECUTE FUNCTION guard_strategy_review();

CREATE TABLE strategy_trade_proofs (
  signature text PRIMARY KEY,
  slot bigint NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER strategy_trade_proofs_immutable BEFORE UPDATE OR DELETE ON strategy_trade_proofs
FOR EACH ROW EXECUTE FUNCTION account_events_immutable();
