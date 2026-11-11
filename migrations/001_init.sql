CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'merchant' CHECK (role IN ('merchant','admin')),
  full_name TEXT NOT NULL, phone TEXT, email_verified BOOLEAN NOT NULL DEFAULT false,
  verify_token_hash TEXT, totp_secret_enc TEXT, status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  business_name TEXT NOT NULL, country TEXT NOT NULL, category TEXT NOT NULL,
  registration_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended','rejected')),
  kyc_status TEXT NOT NULL DEFAULT 'not_submitted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
-- Only settled funds are withdrawable.
CREATE TABLE merchant_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id), currency CHAR(3) NOT NULL CHECK (currency IN ('KES','USD','EUR','GBP')),
  pending_minor BIGINT NOT NULL DEFAULT 0 CHECK (pending_minor >= 0),
  settled_minor BIGINT NOT NULL DEFAULT 0 CHECK (settled_minor >= 0),
  UNIQUE (merchant_id, currency));
CREATE TABLE api_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  label TEXT, environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','live')),
  public_key TEXT UNIQUE NOT NULL, secret_hash TEXT NOT NULL, secret_last4 TEXT NOT NULL,
  revoked_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE kyc_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id UUID NOT NULL REFERENCES merchants(id),
  doc_type TEXT NOT NULL, storage_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'submitted',
  reviewed_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE payment_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT UNIQUE NOT NULL, kind TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false, config_enc TEXT);
INSERT INTO payment_providers(code,kind,enabled) VALUES ('mpesa_daraja','mobile_money',false);
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id UUID NOT NULL REFERENCES merchants(id),
  name TEXT, email TEXT, phone TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id UUID NOT NULL REFERENCES merchants(id),
  slug TEXT UNIQUE NOT NULL, reference TEXT UNIQUE NOT NULL, amount_minor BIGINT, currency CHAR(3) NOT NULL,
  description TEXT, active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id UUID NOT NULL REFERENCES merchants(id),
  provider_code TEXT NOT NULL, merchant_reference TEXT, account_reference TEXT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0), currency CHAR(3) NOT NULL,
  phone TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','cancelled')),
  provider_checkout_id TEXT, provider_receipt TEXT, idempotency_key TEXT,
  credited_at TIMESTAMPTZ, payment_link_id UUID REFERENCES payment_links(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, idempotency_key), UNIQUE (provider_code, provider_receipt));
CREATE TABLE provider_callbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), provider_code TEXT NOT NULL,
  dedupe_key TEXT UNIQUE NOT NULL, payload JSONB NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id UUID NOT NULL REFERENCES merchants(id),
  reference TEXT UNIQUE NOT NULL, method TEXT NOT NULL, amount_minor BIGINT NOT NULL CHECK (amount_minor>0),
  fee_minor BIGINT NOT NULL DEFAULT 0, currency CHAR(3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_approval', approved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id UUID NOT NULL REFERENCES merchants(id),
  url TEXT NOT NULL, signing_secret_enc TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true);
CREATE TABLE fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id UUID REFERENCES merchants(id),
  kind TEXT NOT NULL, percent_bps INT NOT NULL DEFAULT 0, fixed_minor BIGINT NOT NULL DEFAULT 0, currency CHAR(3));
CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id UUID NOT NULL REFERENCES merchants(id),
  subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY, actor_user_id UUID, action TEXT NOT NULL, entity TEXT, entity_id TEXT,
  meta JSONB, ip TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE api_request_logs (
  id BIGSERIAL PRIMARY KEY, credential_id UUID, method TEXT, path TEXT, status INT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
