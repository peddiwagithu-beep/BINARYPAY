import { Router } from "express"; import { z } from "zod"; import rateLimit from "express-rate-limit";
import { pool } from "../db"; import { apiKeyAuth } from "../middleware/apiKey"; import { initiateStk } from "../services/payments"; import { createLink, linkView } from "../services/links";
const r = Router();
r.use(rateLimit({ windowMs: 60_000, limit: 60, keyGenerator: (q) => q.headers.authorization || "anon", validate: false }), apiKeyAuth);
const M = (req: any) => req.apiMerchant;
const pub = "id,provider_code,merchant_reference,account_reference,amount_minor,currency,status,provider_receipt,payment_link_id,created_at";

r.post("/payments", async (req, res) => {
  const p = z.object({ phone: z.string().min(9), amount: z.number().int().min(1).max(250000), reference: z.string().max(64).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "validation", details: p.error.flatten() });
  const out = await initiateStk({ merchant: M(req), phone: p.data.phone, amount: p.data.amount, merchantReference: p.data.reference, idempotencyKey: String(req.header("Idempotency-Key") || "") || null, ip: req.ip });
  res.status(out.status).json(out.body);
});
r.get("/payments/:id", async (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.status(404).json({ error: "not_found" });
  const t = (await pool.query(`SELECT ${pub} FROM transactions WHERE id=$1 AND merchant_id=$2`, [req.params.id, M(req).id])).rows[0];
  t ? res.json(t) : res.status(404).json({ error: "not_found" });
});
r.get("/transactions", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100), offset = Math.max(Number(req.query.offset) || 0, 0);
  res.json((await pool.query(`SELECT ${pub} FROM transactions WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [M(req).id, limit, offset])).rows);
});
r.get("/balance", async (req, res) => res.json((await pool.query("SELECT currency,pending_minor,settled_minor FROM merchant_accounts WHERE merchant_id=$1", [M(req).id])).rows));
r.post("/payment-links", async (req, res) => {
  const p = z.object({ amount: z.number().positive().max(250000).optional(), description: z.string().max(200).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "validation" });
  res.status(201).json(linkView(await createLink(M(req).id, p.data)));
});
r.get("/payment-links", async (req, res) => res.json((await pool.query("SELECT * FROM payment_links WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 100", [M(req).id])).rows.map(linkView)));
r.get("/payouts", async (req, res) => res.json((await pool.query("SELECT id,reference,method,currency,amount_minor,fee_minor,status,created_at,processed_at FROM payouts WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 100", [M(req).id])).rows));
export default r;
