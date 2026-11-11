import { pool, audit } from "../db"; import { mpesa } from "../providers/mpesa";
export interface StkInput { merchant: any; phone: string; amount: number; merchantReference?: string; idempotencyKey?: string | null; paymentLinkId?: string | null; actor?: string | null; ip?: string; }
// Shared by dashboard, public API and payment-link checkout. Always returns "pending": only a verified Daraja callback can mark success.
export async function initiateStk(i: StkInput): Promise<{ status: number; body: any }> {
  const m = i.merchant;
  if (m.status !== "approved") return { status: 403, body: { error: "merchant_not_approved" } };
  const prov = (await pool.query("SELECT enabled FROM payment_providers WHERE code='mpesa_daraja'")).rows[0];
  if (!prov?.enabled) return { status: 503, body: { error: "provider_disabled" } };
  const idem = i.idempotencyKey || null; let t;
  try {
    t = (await pool.query("INSERT INTO transactions(merchant_id,provider_code,merchant_reference,account_reference,amount_minor,currency,phone,idempotency_key,payment_link_id) VALUES($1,'mpesa_daraja',$2,$3,$4,'KES',$5,$6,$7) RETURNING *",
      [m.id, i.merchantReference, m.account_ref, i.amount * 100, i.phone, idem, i.paymentLinkId || null])).rows[0];
  } catch (e: any) {
    if (e.code === "23505" && idem) return { status: 200, body: (await pool.query("SELECT id,status,amount_minor,currency FROM transactions WHERE merchant_id=$1 AND idempotency_key=$2", [m.id, idem])).rows[0] };
    throw e;
  }
  try {
    const out = await mpesa.collect({ transactionId: t.id, amountMinor: t.amount_minor, currency: "KES", phone: i.phone, reference: m.account_ref, description: "Payment" });
    await pool.query("UPDATE transactions SET provider_checkout_id=$1 WHERE id=$2", [out.providerCheckoutId, t.id]);
    await audit(i.actor || null, "mpesa.stk_initiated", "transaction", t.id, { amount: i.amount, link: i.paymentLinkId || null }, i.ip);
    return { status: 202, body: { id: t.id, status: "pending", message: "Prompt sent. Customer must enter their M-PESA PIN." } };
  } catch (e: any) {
    await pool.query("UPDATE transactions SET status='failed' WHERE id=$1", [t.id]);
    await audit(i.actor || null, "mpesa.stk_initiation_failed", "transaction", t.id, { err: e.message, daraja: e.body });
    const bad = e.message === "invalid_phone";
    return { status: bad ? 400 : 502, body: { id: t.id, status: "failed", error: bad ? "invalid_phone" : "provider_error" } };
  }
}
