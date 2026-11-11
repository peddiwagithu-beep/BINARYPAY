INSERT INTO payment_providers(code,kind,enabled) VALUES ('bank_transfer','bank',false) ON CONFLICT DO NOTHING;
