import { Router } from "express"; import { z } from "zod"; import rateLimit from "express-rate-limit";
import { pool } from "../db"; import { initiateStk } from "../services/payments";
const r = Router();
async function load(slug: string) {
  return (await pool.query("SELECT l.*,m.business_name,m.status AS mstatus FROM payment_links l JOIN merchants m ON m.id=l.merchant_id WHERE l.slug=$1", [slug])).rows[0];
}
r.get("/links/:slug", async (req, res) => {
  const l = await load(req.params.slug);
  if (!l || !l.active || l.mstatus !== "approved") return res.status(404).json({ error: "link_unavailable" });
  res.json({ businessName: l.business_name, description: l.description, currency: l.currency, amount: l.amount_minor == null ? null : Number(l.amount_minor) / 100 });
});
// Anyone can open a link, so limit prompts per IP and per phone number to stop M-PESA prompt spam.
r.post("/links/:slug/pay", rateLimit({ windowMs: 10 * 60_000, limit: 6 }), async (req, res) => {
  const p = z.object({ phone: z.string().min(9), amount: z.number().int().min(1).max(250000).optional(), key: z.string().max(64).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "validation" });
  const l = await load(req.params.slug);
  if (!l || !l.active || l.mstatus !== "approved") return res.status(404).json({ error: "link_unavailable" });
  const amount = l.amount_minor != null ? Number(l.amount_minor) / 100 : p.data.amount;
  if (!amount) return res.status(400).json({ error: "amount_required" });
  const recent = (await pool.query("SELECT count(*)::int AS n FROM transactions WHERE phone=$1 AND created_at>now()-interval '10 minutes'", [p.data.phone])).rows[0].n;
  if (recent >= 3) return res.status(429).json({ error: "too_many_attempts" });
  const m = (await pool.query("SELECT * FROM merchants WHERE id=$1", [l.merchant_id])).rows[0];
  const out = await initiateStk({ merchant: m, phone: p.data.phone, amount, merchantReference: l.reference, idempotencyKey: p.data.key ? "link:" + p.data.key : null, paymentLinkId: l.id, ip: req.ip });
  res.status(out.status).json(out.body);
});
r.get("/payments/:id", async (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.status(404).json({ error: "not_found" });
  const t = (await pool.query("SELECT status,provider_receipt FROM transactions WHERE id=$1 AND payment_link_id IS NOT NULL", [req.params.id])).rows[0];
  t ? res.json({ status: t.status, receipt: t.provider_receipt }) : res.status(404).json({ error: "not_found" });
});
export default r;
