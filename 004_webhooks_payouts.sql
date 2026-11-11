CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL, event_type TEXT NOT NULL, payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed')),
  attempts INT NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_http_status INT, last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (webhook_id, event_id));
CREATE INDEX webhook_deliveries_due ON webhook_deliveries(next_attempt_at) WHERE status='pending';
ALTER TABLE webhooks ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE payouts ADD COLUMN destination JSONB, ADD COLUMN rejection_reason TEXT, ADD COLUMN provider_ref TEXT,
  ADD COLUMN processed_at TIMESTAMPTZ, ADD COLUMN idempotency_key TEXT;
ALTER TABLE payouts ADD CONSTRAINT payouts_status_chk CHECK (status IN ('pending_approval','paid','rejected'));
CREATE UNIQUE INDEX payouts_idem_uq ON payouts(merchant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX payouts_providerref_uq ON payouts(provider_ref) WHERE provider_ref IS NOT NULL;
CREATE UNIQUE INDEX fees_global_uq ON fees(kind, currency) WHERE merchant_id IS NULL;
