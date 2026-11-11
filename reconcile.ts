import { pool, audit } from "../db"; import { enqueueEvent, paymentData } from "./webhooks"; import { stkQuery } from "../providers/mpesa";
// Safety net for lost callbacks. A query can mark a payment FAILED, but never credits money (it carries no receipt):
// a "success" with no callback is flagged for admin reconciliation against the Paybill statement.
export async function reconcilePending() {
  const rows = (await pool.query("SELECT id,provider_checkout_id FROM transactions WHERE status='pending' AND provider_code='mpesa_daraja' AND provider_checkout_id IS NOT NULL AND created_at < now()-interval '3 minutes' LIMIT 20")).rows;
  for (const t of rows) {
    try {
      const q: any = await stkQuery(t.provider_checkout_id); const code = String(q.ResultCode);
      if (code === "0") await audit(null, "mpesa.reconcile.success_without_callback", "transaction", t.id, q);
      else if (q.ResultCode !== undefined) {
        const st = code === "1032" ? "cancelled" : "failed";
        const u = (await pool.query("UPDATE transactions SET status=$1 WHERE id=$2 AND status='pending' RETURNING *", [st, t.id])).rows[0];
        if (u) await enqueueEvent(pool, u.merchant_id, "payment.failed", paymentData(u, st));
      }
    } catch { /* still processing or transient: retry next cycle */ }
  }
}
