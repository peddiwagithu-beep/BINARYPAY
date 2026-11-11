import { Router } from "express"; import { z } from "zod";
import { pool, audit } from "../db"; import { requireAuth, requireRole } from "../middleware/auth"; import { initiateStk } from "../services/payments"; import { bankInfo } from "../providers/bank"; import crypto from "crypto";
const r = Router(); r.use(requireAuth, requireRole("merchant"));
const body = z.object({ phone: z.string().min(9), amount: z.number().int().min(1).max(250000), merchantReference: z.string().max(64).optional() });

// Initiates STK Push. Response is ALWAYS "pending"; only a verified Daraja callback can mark it succeeded.
r.post("/mpesa/stk", async (req, res) => {
  const p = body.safeParse(req.body); if (!p.success) return res.status(400).json({ error: "validation", details: p.error.flatten() });
  const m = (await pool.query("SELECT * FROM merchants WHERE owner_user_id=$1", [req.user!.id])).rows[0];
  const out = await initiateStk({ merchant: m, phone: p.data.phone, amount: p.data.amount, merchantReference: p.data.merchantReference, idempotencyKey: String(req.header("Idempotency-Key") || "") || null, actor: req.user!.id, ip: req.ip });
  res.status(out.status).json(out.body);
});
r.get("/bank/info", (_q, res) => { const b = bankInfo(); res.json({ enabled: !!b, currency: b?.currency || null }); });
// Creates a PENDING bank-transfer request with a unique reference the customer must quote. Never auto-confirmed.
r.post("/bank", async (req, res) => {
  const p = z.object({ amount: z.number().positive().max(100000000), merchantReference: z.string().max(64).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "validation" });
  const b = bankInfo(); const prov = (await pool.query("SELECT enabled FROM payment_providers WHERE code='bank_transfer'")).rows[0];
  if (!b || !prov?.enabled) return res.status(503).json({ error: "provider_disabled" });
  const m = (await pool.query("SELECT * FROM merchants WHERE owner_user_id=$1", [req.user!.id])).rows[0];
  if (m.status !== "approved") return res.status(403).json({ error: "merchant_not_approved" });
  const ref = "BNK" + crypto.randomBytes(5).toString("hex").toUpperCase();
  const t = (await pool.query("INSERT INTO transactions(merchant_id,provider_code,merchant_reference,account_reference,amount_minor,currency) VALUES($1,'bank_transfer',$2,$3,$4,$5) RETURNING id", [m.id, p.data.merchantReference, ref, Math.round(p.data.amount * 100), b.currency])).rows[0];
  await audit(req.user!.id, "bank.transfer_requested", "transaction", t.id, { amount: p.data.amount }, req.ip);
  res.status(201).json({ id: t.id, status: "pending", reference: ref, amount: p.data.amount, currency: b.currency, instructions: b,
    message: "Pay this exact amount and quote the reference in the transfer narration. Status changes after the bank credit is verified." });
});
r.get("/transactions", async (req, res) => {
  const m = (await pool.query("SELECT id FROM merchants WHERE owner_user_id=$1", [req.user!.id])).rows[0];
  res.json((await pool.query("SELECT id,provider_code,merchant_reference,account_reference,amount_minor,currency,status,provider_receipt,created_at FROM transactions WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 100", [m.id])).rows);
});
r.get("/transactions/:id", async (req, res) => {
  const m = (await pool.query("SELECT id FROM merchants WHERE owner_user_id=$1", [req.user!.id])).rows[0];
  const t = (await pool.query("SELECT id,status,amount_minor,currency,provider_receipt,created_at FROM transactions WHERE id=$1 AND merchant_id=$2", [req.params.id, m.id])).rows[0];
  t ? res.json(t) : res.status(404).json({ error: "not_found" });
});
export default r;
