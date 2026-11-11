import { Router } from "express"; import { pool, tx, audit } from "../db"; import { z } from "zod"; import { creditPending } from "../services/ledger"; import { enqueueEvent, paymentData } from "../services/webhooks"; import { registerC2B } from "../providers/mpesa"; import { requireAuth, requireRole } from "../middleware/auth";
const r = Router(); r.use(requireAuth, requireRole("admin"));
r.get("/merchants", async (_q, res) => res.json((await pool.query(
  "SELECT m.*,u.email,u.full_name,u.email_verified FROM merchants m JOIN users u ON u.id=m.owner_user_id ORDER BY m.created_at DESC LIMIT 200")).rows));
const setStatus = (status: string, action: string) => async (req: any, res: any) => {
  const q = await pool.query("UPDATE merchants SET status=$1 WHERE id=$2 RETURNING id", [status, req.params.id]);
  if (!q.rowCount) return res.status(404).json({ error: "not_found" });
  await audit(req.user.id, action, "merchant", req.params.id, {}, req.ip); res.json({ ok: true });
};
r.post("/merchants/:id/approve", setStatus("approved", "admin.merchant.approve"));
r.post("/merchants/:id/suspend", setStatus("suspended", "admin.merchant.suspend"));
r.post("/merchants/:id/activate", setStatus("approved", "admin.merchant.activate"));
r.get("/audit-logs", async (_q, res) => res.json((await pool.query("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200")).rows));
r.post("/providers/:code/:state(enable|disable)", async (req: any, res) => {
  await pool.query("UPDATE payment_providers SET enabled=$1 WHERE code=$2", [req.params.state === "enable", req.params.code]);
  await audit(req.user.id, "admin.provider." + req.params.state, "provider", req.params.code, {}, req.ip); res.json({ ok: true });
});
r.post("/mpesa/register-c2b", async (req: any, res) => {
  try { const j = await registerC2B(); await audit(req.user.id, "admin.mpesa.register_c2b", "provider", "mpesa_daraja", j, req.ip); res.json(j); }
  catch (e: any) { res.status(502).json({ error: "daraja_error", detail: e.body || e.message }); }
});
r.get("/transactions", async (_q, res) => res.json((await pool.query("SELECT t.*,m.business_name FROM transactions t JOIN merchants m ON m.id=t.merchant_id ORDER BY t.created_at DESC LIMIT 200")).rows));
r.get("/unreconciled", async (_q, res) => res.json((await pool.query("SELECT * FROM audit_logs WHERE action LIKE '%unmatched%' OR action LIKE '%mismatch%' OR action LIKE '%without_callback%' ORDER BY id DESC LIMIT 200")).rows));
r.post("/transactions/:id/confirm-bank", async (req: any, res) => {
  const p = z.object({ bankReference: z.string().min(4).max(64), receivedAmount: z.number().positive() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "validation" });
  try {
    const out = await tx(async (c) => {
      const t = (await c.query("SELECT * FROM transactions WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!t || t.provider_code !== "bank_transfer") return "not_found";
      if (t.status !== "pending") return "not_pending";
      if (Math.round(p.data.receivedAmount * 100) !== Number(t.amount_minor)) return "amount_mismatch"; // never credit a different amount
      await c.query("UPDATE transactions SET status='succeeded', provider_receipt=$1, credited_at=now() WHERE id=$2", [p.data.bankReference, t.id]);
      await creditPending(c, t.merchant_id, t.currency, Number(t.amount_minor));
      await enqueueEvent(c, t.merchant_id, "payment.succeeded", paymentData(t, "succeeded", p.data.bankReference)); return "credited";
    });
    await audit(req.user.id, "admin.bank.confirm." + out, "transaction", req.params.id, { ref: p.data.bankReference }, req.ip);
    res.status(out === "credited" ? 200 : out === "not_found" ? 404 : 409).json({ result: out });
  } catch (e: any) { res.status(e.code === "23505" ? 409 : 500).json({ error: e.code === "23505" ? "bank_reference_already_used" : "server_error" }); }
});
r.post("/transactions/:id/reject-bank", async (req: any, res) => {
  const q = await pool.query("UPDATE transactions SET status='failed' WHERE id=$1 AND provider_code='bank_transfer' AND status='pending' RETURNING *", [req.params.id]);
  if (!q.rowCount) return res.status(409).json({ error: "not_pending" });
  await enqueueEvent(pool, q.rows[0].merchant_id, "payment.failed", paymentData(q.rows[0], "failed"));
  await audit(req.user.id, "admin.bank.reject", "transaction", req.params.id, {}, req.ip); res.json({ ok: true });
});
// Moves PENDING -> SETTLED (withdrawable). Do this only after funds have really settled to your account.
r.post("/merchants/:id/settle", async (req: any, res) => {
  const p = z.object({ currency: z.enum(["KES", "USD", "EUR", "GBP"]), amount: z.number().positive() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "validation" });
  const minor = Math.round(p.data.amount * 100);
  const q = await pool.query("UPDATE merchant_accounts SET pending_minor=pending_minor-$1, settled_minor=settled_minor+$1 WHERE merchant_id=$2 AND currency=$3 AND pending_minor>=$1 RETURNING id", [minor, req.params.id, p.data.currency]);
  if (!q.rowCount) return res.status(409).json({ error: "insufficient_pending_balance" });
  await audit(req.user.id, "admin.settle", "merchant", req.params.id, p.data, req.ip); res.json({ ok: true });
});
r.post("/merchants/:id/verify-email", async (req: any, res) => {
  await pool.query("UPDATE users SET email_verified=true WHERE id=(SELECT owner_user_id FROM merchants WHERE id=$1)", [req.params.id]);
  await audit(req.user.id, "admin.verify_email", "merchant", req.params.id, {}, req.ip); res.json({ ok: true });
});
r.post("/merchants/:id/kyc", async (req: any, res) => {
  const p = z.object({ status: z.enum(["verified", "rejected", "not_submitted"]) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "validation" });
  const q = await pool.query("UPDATE merchants SET kyc_status=$1 WHERE id=$2 RETURNING id", [p.data.status, req.params.id]);
  if (!q.rowCount) return res.status(404).json({ error: "not_found" });
  await audit(req.user.id, "admin.kyc." + p.data.status, "merchant", req.params.id, {}, req.ip); res.json({ ok: true });
});
const pview = (p: any) => ({ ...p, amount: Number(p.amount_minor) / 100, fee: Number(p.fee_minor) / 100 });
r.get("/payouts", async (_q, res) => res.json((await pool.query("SELECT p.*,m.business_name FROM payouts p JOIN merchants m ON m.id=p.merchant_id ORDER BY (p.status='pending_approval') DESC, p.created_at DESC LIMIT 200")).rows.map(pview)));
// Manual completion: the admin sends the money (bank or M-PESA business portal), then records the real reference here.
r.post("/payouts/:id/mark-paid", async (req: any, res) => {
  const p = z.object({ reference: z.string().min(4).max(64) }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: "validation" });
  try {
    const q = await pool.query("UPDATE payouts SET status='paid',provider_ref=$1,approved_by=$2,processed_at=now() WHERE id=$3 AND status='pending_approval' RETURNING *", [p.data.reference, req.user.id, req.params.id]);
    if (!q.rowCount) return res.status(409).json({ error: "not_pending" });
    await enqueueEvent(pool, q.rows[0].merchant_id, "payout.paid", { id: q.rows[0].id, reference: q.rows[0].reference, status: "paid", amount_minor: Number(q.rows[0].amount_minor), currency: q.rows[0].currency });
    await audit(req.user.id, "admin.payout.paid", "payout", req.params.id, { ref: p.data.reference }, req.ip); res.json({ ok: true });
  } catch (e: any) { res.status(e.code === "23505" ? 409 : 500).json({ error: e.code === "23505" ? "reference_already_used" : "server_error" }); }
});
r.post("/payouts/:id/reject", async (req: any, res) => {
  const p = z.object({ reason: z.string().min(3).max(200) }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: "validation" });
  const out = await tx(async (c) => {
    const q = await c.query("UPDATE payouts SET status='rejected',rejection_reason=$1,approved_by=$2,processed_at=now() WHERE id=$3 AND status='pending_approval' RETURNING *", [p.data.reason, req.user.id, req.params.id]);
    if (!q.rowCount) return null; const row = q.rows[0];
    await c.query("UPDATE merchant_accounts SET settled_minor=settled_minor+$1 WHERE merchant_id=$2 AND currency=$3", [Number(row.amount_minor) + Number(row.fee_minor), row.merchant_id, row.currency]); // refund held funds, once
    await enqueueEvent(c, row.merchant_id, "payout.rejected", { id: row.id, reference: row.reference, status: "rejected", reason: p.data.reason }); return row;
  });
  if (!out) return res.status(409).json({ error: "not_pending" });
  await audit(req.user.id, "admin.payout.rejected", "payout", req.params.id, { reason: p.data.reason }, req.ip); res.json({ ok: true });
});
r.get("/fees", async (_q, res) => res.json((await pool.query("SELECT kind,currency,percent_bps,fixed_minor FROM fees WHERE merchant_id IS NULL ORDER BY kind,currency")).rows));
r.put("/fees", async (req: any, res) => {
  const p = z.object({ kind: z.enum(["payout_mpesa", "payout_bank"]), currency: z.enum(["KES", "USD", "EUR", "GBP"]), percent_bps: z.number().int().min(0).max(2000), fixed_minor: z.number().int().min(0).max(100000000) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "validation" });
  await pool.query("INSERT INTO fees(kind,currency,percent_bps,fixed_minor) VALUES($1,$2,$3,$4) ON CONFLICT (kind,currency) WHERE merchant_id IS NULL DO UPDATE SET percent_bps=$3,fixed_minor=$4", [p.data.kind, p.data.currency, p.data.percent_bps, p.data.fixed_minor]);
  await audit(req.user.id, "admin.fee.set", "fee", p.data.kind + ":" + p.data.currency, p.data, req.ip); res.json({ ok: true });
});
export default r;
