import { Router } from "express"; import { z } from "zod";
import crypto from "crypto";
import { pool, tx, audit } from "../db"; import { requireAuth, requireRole } from "../middleware/auth"; import { normalizePhone } from "../providers/mpesa";
const r = Router(); r.use(requireAuth, requireRole("merchant"));
const body = z.object({ method: z.enum(["mpesa", "bank"]), currency: z.enum(["KES", "USD", "EUR", "GBP"]), amount: z.number().positive().max(10_000_000),
  destination: z.object({ phone: z.string().optional(), bankName: z.string().max(80).optional(), accountNumber: z.string().max(40).optional(), accountName: z.string().max(80).optional() }) });
const view = (p: any) => ({ id: p.id, reference: p.reference, method: p.method, currency: p.currency, amount: Number(p.amount_minor) / 100, fee: Number(p.fee_minor) / 100, status: p.status, destination: p.destination, rejection_reason: p.rejection_reason, provider_ref: p.provider_ref, created_at: p.created_at, processed_at: p.processed_at });

// Only SETTLED funds can be withdrawn. Amount + fee is deducted immediately (held); a rejection refunds it exactly once.
r.post("/", async (req, res) => {
  const p = body.safeParse(req.body); if (!p.success) return res.status(400).json({ error: "validation" });
  const d = p.data; let dest: any;
  try {
    if (d.method === "mpesa") { if (d.currency !== "KES") return res.status(400).json({ error: "mpesa_kes_only" }); dest = { phone: normalizePhone(d.destination.phone || "") }; }
    else { const { bankName, accountNumber, accountName } = d.destination; if (!bankName || !accountNumber || !accountName) return res.status(400).json({ error: "bank_details_required" }); dest = { bankName, accountNumber, accountName }; }
  } catch { return res.status(400).json({ error: "invalid_phone" }); }
  const m = (await pool.query("SELECT * FROM merchants WHERE owner_user_id=$1", [req.user!.id])).rows[0];
  if (m.status !== "approved") return res.status(403).json({ error: "merchant_not_approved" });
  if (m.kyc_status !== "verified") return res.status(403).json({ error: "kyc_required_for_payouts" });
  if (d.amount < Number(process.env.PAYOUT_MIN || 1)) return res.status(400).json({ error: "below_minimum_payout" });
  const idem = String(req.header("Idempotency-Key") || "") || null, minor = Math.round(d.amount * 100);
  const out = await tx(async (c) => {
    const a = (await c.query("SELECT * FROM merchant_accounts WHERE merchant_id=$1 AND currency=$2 FOR UPDATE", [m.id, d.currency])).rows[0]; // serialises concurrent requests
    if (idem) { const ex = (await c.query("SELECT * FROM payouts WHERE merchant_id=$1 AND idempotency_key=$2", [m.id, idem])).rows[0]; if (ex) return { existing: ex }; }
    const f = (await c.query("SELECT percent_bps,fixed_minor FROM fees WHERE merchant_id IS NULL AND kind=$1 AND currency=$2", ["payout_" + d.method, d.currency])).rows[0];
    const fee = f ? Math.round((minor * f.percent_bps) / 10000) + Number(f.fixed_minor) : 0;
    if (!a || Number(a.settled_minor) < minor + fee) return { error: "insufficient_settled_balance" };
    await c.query("UPDATE merchant_accounts SET settled_minor=settled_minor-$1 WHERE id=$2", [minor + fee, a.id]);
    const ref = "PO" + crypto.randomBytes(5).toString("hex").toUpperCase();
    return { created: (await c.query("INSERT INTO payouts(merchant_id,reference,method,amount_minor,fee_minor,currency,destination,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *", [m.id, ref, d.method, minor, fee, d.currency, JSON.stringify(dest), idem])).rows[0] };
  });
  if ((out as any).error) return res.status(409).json({ error: (out as any).error });
  if ((out as any).existing) return res.json(view((out as any).existing));
  const row = (out as any).created; await audit(req.user!.id, "payout.requested", "payout", row.id, { amount: d.amount, method: d.method, currency: d.currency }, req.ip);
  res.status(201).json(view(row));
});
r.get("/", async (req, res) => {
  const m = (await pool.query("SELECT id FROM merchants WHERE owner_user_id=$1", [req.user!.id])).rows[0];
  res.json((await pool.query("SELECT * FROM payouts WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 100", [m.id])).rows.map(view));
});
r.get("/fees", async (_q, res) => res.json((await pool.query("SELECT kind,currency,percent_bps,fixed_minor FROM fees WHERE merchant_id IS NULL ORDER BY kind,currency")).rows));
export default r;
