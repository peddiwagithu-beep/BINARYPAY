import { Router, Request, Response, NextFunction } from "express"; import crypto from "crypto";
import { pool, tx, audit } from "../db"; import { enqueueEvent, paymentData } from "../services/webhooks"; import { creditPending } from "../services/ledger";
const r = Router();
// Safaricom does not sign callbacks, so: secret path segment + must match a transaction WE created + amount check + dedupe.
r.use("/:secret", (req: Request, res: Response, next: NextFunction) => {
  const a = Buffer.from(req.params.secret), b = Buffer.from(process.env.MPESA_CALLBACK_SECRET || "");
  a.length === b.length && b.length >= 24 && crypto.timingSafeEqual(a, b) ? next() : res.sendStatus(404);
});
const ack = { ResultCode: 0, ResultDesc: "Accepted" };

r.post("/:secret/stk", async (req, res) => {
  const cb = req.body?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== "string" || typeof cb.ResultCode !== "number") return res.status(400).json({ error: "bad_payload" });
  try {
    const outcome = await tx(async (c) => {
      const d = await c.query("INSERT INTO provider_callbacks(provider_code,dedupe_key,payload) VALUES('mpesa_daraja',$1,$2) ON CONFLICT DO NOTHING RETURNING id", ["stk:" + cb.CheckoutRequestID, JSON.stringify(req.body)]);
      if (!d.rowCount) return { kind: "duplicate" };
      const t = (await c.query("SELECT * FROM transactions WHERE provider_checkout_id=$1 FOR UPDATE", [cb.CheckoutRequestID])).rows[0];
      if (!t) return { kind: "unknown_checkout" };
      if (t.status !== "pending") return { kind: "already_final" };
      if (cb.ResultCode !== 0) {
        const st = cb.ResultCode === 1032 ? "cancelled" : "failed";
        await c.query("UPDATE transactions SET status=$1 WHERE id=$2", [st, t.id]);
        await enqueueEvent(c, t.merchant_id, "payment.failed", paymentData(t, st));
        return { kind: "failed", id: t.id, code: cb.ResultCode };
      }
      const items: Record<string, any> = Object.fromEntries((cb.CallbackMetadata?.Item || []).map((i: any) => [i.Name, i.Value]));
      const amount = Number(items.Amount), receipt = String(items.MpesaReceiptNumber || "");
      if (!receipt || Math.round(amount * 100) !== Number(t.amount_minor)) return { kind: "amount_or_receipt_mismatch", id: t.id }; // NOT credited; left pending for admin review
      await c.query("UPDATE transactions SET status='succeeded', provider_receipt=$1, credited_at=now() WHERE id=$2", [receipt, t.id]);
      await creditPending(c, t.merchant_id, t.currency, Number(t.amount_minor));
      await enqueueEvent(c, t.merchant_id, "payment.succeeded", paymentData(t, "succeeded", receipt));
      return { kind: "credited", id: t.id, receipt };
    });
    await audit(null, "mpesa.stk_callback." + outcome.kind, "transaction", (outcome as any).id, { checkout: cb.CheckoutRequestID, code: cb.ResultCode });
  } catch (e) { console.error("stk callback error", e); }
  res.json(ack);
});

r.post("/:secret/c2b/validate", async (req, res) => {
  const m = (await pool.query("SELECT status FROM merchants WHERE account_ref=$1", [String(req.body?.BillRefNumber || "").trim().toUpperCase()])).rows[0];
  res.json(m?.status === "approved" ? { ResultCode: "0", ResultDesc: "Accepted" } : { ResultCode: "C2B00012", ResultDesc: "Rejected" });
});

r.post("/:secret/c2b/confirm", async (req, res) => {
  const b = req.body || {}; const transId = String(b.TransID || ""), ref = String(b.BillRefNumber || "").trim().toUpperCase(), amt = Number(b.TransAmount);
  if (!transId || !(amt > 0)) return res.status(400).json({ error: "bad_payload" });
  try {
    const outcome = await tx(async (c) => {
      const d = await c.query("INSERT INTO provider_callbacks(provider_code,dedupe_key,payload) VALUES('mpesa_daraja',$1,$2) ON CONFLICT DO NOTHING RETURNING id", ["c2b:" + transId, JSON.stringify(b)]);
      if (!d.rowCount) return "duplicate";
      const m = (await c.query("SELECT id FROM merchants WHERE account_ref=$1", [ref])).rows[0];
      if (!m) return "unmatched_account_ref"; // money reached the Paybill but isn't allocated: admin must reconcile
      const minor = Math.round(amt * 100);
      const ins = await c.query("INSERT INTO transactions(merchant_id,provider_code,account_reference,amount_minor,currency,phone,status,provider_receipt,credited_at) VALUES($1,'mpesa_daraja',$2,$3,'KES',$4,'succeeded',$5,now()) RETURNING id", [m.id, ref, minor, b.MSISDN ? String(b.MSISDN) : null, transId]);
      await creditPending(c, m.id, "KES", minor);
      await enqueueEvent(c, m.id, "payment.succeeded", { id: ins.rows[0].id, status: "succeeded", amount_minor: minor, currency: "KES", reference: ref, receipt: transId });
      return "credited";
    });
    await audit(null, "mpesa.c2b_confirm." + outcome, "c2b", transId, { ref, amt });
  } catch (e) { console.error("c2b confirm error", e); }
  res.json(ack);
});
export default r;
