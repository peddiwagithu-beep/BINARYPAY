import crypto from "crypto"; import { pool } from "../db";
export async function createLink(merchantId: string, d: { amount?: number; description?: string }) {
  const slug = crypto.randomBytes(6).toString("hex"), reference = "PL" + crypto.randomBytes(5).toString("hex").toUpperCase();
  return (await pool.query("INSERT INTO payment_links(merchant_id,slug,reference,amount_minor,currency,description) VALUES($1,$2,$3,$4,'KES',$5) RETURNING id,slug,reference,amount_minor,currency,description,active,created_at",
    [merchantId, slug, reference, d.amount ? Math.round(d.amount * 100) : null, d.description || null])).rows[0];
}
export const linkView = (l: any) => ({ id: l.id, url_path: "/pay/" + l.slug, slug: l.slug, reference: l.reference, amount: l.amount_minor == null ? null : Number(l.amount_minor) / 100, currency: l.currency, description: l.description, active: l.active, created_at: l.created_at });
