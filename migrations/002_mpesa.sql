ALTER TABLE merchants ADD COLUMN account_ref TEXT UNIQUE;
UPDATE merchants SET account_ref = 'HGP' || upper(substr(replace(id::text,'-',''),1,8));
ALTER TABLE merchants ALTER COLUMN account_ref SET NOT NULL;
CREATE UNIQUE INDEX transactions_checkout_uq ON transactions(provider_checkout_id) WHERE provider_checkout_id IS NOT NULL;
