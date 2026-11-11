import { Router } from "express"; import crypto from "crypto";
import { pool, tx, audit } from "../db"; import { createLink, linkView } from "../services/links"; import { z } from "zod"; import { assertSafeUrl, enqueueTo } from "../services/webhooks"; import { encrypt } from "../services/crypto"; import { requireAuth, requireRole } from "../middleware/auth";
const r = Router(); r.use(requireAuth, requireRole("merchant"));
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
async function merchantOf(uid: string) { return (await pool.query("SELECT * FROM merchants WHERE owner_user_id=$1", [uid])).rows[0]; }

r.get("/me", async (req, res) => res.json({ merchant: await merchantOf(req.user!.id) }));
r.get("/stats", async (req, res) => {
  const m = await merchantOf(req.user!.id);
  res.json((await pool.query("SELECT status,currency,count(*)::int AS count,COALESCE(sum(amount_minor),0)::text AS total FROM transactions WHERE merchant_id=$1 GROUP BY 1,2", [m.id])).rows);
});
r.get("/balance", async (req, res) => {
  const m = await merchantOf(req.user!.id);
  res.json((await pool.query("SELECT currency,pending_minor,settled_minor FROM merchant_accounts WHERE merchant_id=$1", [m.id])).rows);
});
r.get("/api-keys", async (req, res) => {
  const m = await merchantOf(req.user!.id);
  res.json((await pool.query("SELECT id,label,environment,public_key,secret_last4,revoked_at,last_used_at,created_at FROM api_credentials WHERE merchant_id=$1 ORDER BY created_at DESC", [m.id])).rows);
});
async function createKey(c: any, merchantId: string, env: string, label?: string) {
  const pub = `hgp_pk_${env}_${crypto.randomBytes(12).toString("hex")}`;
  const secret = `hgp_sk_${env}_${crypto.randomBytes(32).toString("hex")}`;
  await c.query("INSERT INTO api_credentials(merchant_id,label,environment,public_key,secret_hash,secret_last4) VALUES($1,$2,$3,$4,$5,$6)",
    [merchantId, label, env, pub, sha(secret), secret.slice(-4)]);
  return { publicKey: pub, secretKey: secret }; // secret shown ONCE; only its hash is stored
}
r.post("/api-keys", async (req, res) => {
  const m = await merchantOf(req.user!.id);
  const env = req.body.environment === "live" ? "live" : "sandbox";
  if (m.status !== "approved") return res.status(403).json({ error: "merchant_not_approved" });
  if (env === "live" && m.kyc_status !== "verified") return res.status(403).json({ error: "kyc_required_for_live_keys" });
  const keys = await tx((c) => createKey(c, m.id, env, req.body.label));
  await audit(req.user!.id, "apikey.created", "merchant", m.id, { env }, req.ip);
  res.status(201).json({ ...keys, warning: "Store the secret key now. It cannot be shown again." });
});
r.post("/api-keys/:id/revoke", async (req, res) => {
  const m = await merchantOf(req.user!.id);
  const q = await pool.query("UPDATE api_credentials SET revoked_at=now() WHERE id=$1 AND merchant_id=$2 AND revoked_at IS NULL RETURNING id", [req.params.id, m.id]);
  if (!q.rowCount) return res.status(404).json({ error: "not_found" });
  await audit(req.user!.id, "apikey.revoked", "api_credential", req.params.id, {}, req.ip); res.json({ ok: true });
});
r.post("/api-keys/:id/regenerate", async (req, res) => {
  const m = await merchantOf(req.user!.id);
  try {
    const keys = await tx(async (c) => {
      const o = await c.query("UPDATE api_credentials SET revoked_at=now() WHERE id=$1 AND merchant_id=$2 AND revoked_at IS NULL RETURNING environment,label", [req.params.id, m.id]);
      if (!o.rowCount) throw new Error("nf"); return createKey(c, m.id, o.rows[0].environment, o.rows[0].label);
    });
    await audit(req.user!.id, "apikey.regenerated", "api_credential", req.params.id, {}, req.ip); res.status(201).json(keys);
  } catch { res.status(404).json({ error: "not_found" }); }
});
r.get("/payment-links", async (req, res) => {
  const m = await merchantOf(req.user!.id);
  res.json((await pool.query("SELECT l.*,(SELECT count(*)::int FROM transactions t WHERE t.payment_link_id=l.id AND t.status='succeeded') AS paid FROM payment_links l WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 100", [m.id])).rows.map((l) => ({ ...linkView(l), paid: l.paid })));
});
r.post("/payment-links", async (req, res) => {
  const p = z.object({ amount: z.number().positive().max(250000).optional(), description: z.string().max(200).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "validation" });
  const m = await merchantOf(req.user!.id); if (m.status !== "approved") return res.status(403).json({ error: "merchant_not_approved" });
  const l = await createLink(m.id, p.data); await audit(req.user!.id, "paymentlink.created", "payment_link", l.id, {}, req.ip); res.status(201).json(linkView(l));
});
r.post("/payment-links/:id/deactivate", async (req, res) => {
  const m = await merchantOf(req.user!.id);
  const q = await pool.query("UPDATE payment_links SET active=false WHERE id=$1 AND merchant_id=$2 RETURNING id", [req.params.id, m.id]);
  q.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: "not_found" });
});
r.get("/api-usage", async (req, res) => {
  const m = await merchantOf(req.user!.id);
  res.json((await pool.query("SELECT l.method,l.path,l.status,l.created_at,c.public_key FROM api_request_logs l JOIN api_credentials c ON c.id=l.credential_id WHERE c.merchant_id=$1 ORDER BY l.id DESC LIMIT 30", [m.id])).rows);
});
r.get("/webhooks", async (req, res) => {
  const m = await merchantOf(req.user!.id);
  res.json((await pool.query("SELECT id,url,active,created_at FROM webhooks WHERE merchant_id=$1 ORDER BY created_at DESC", [m.id])).rows);
});
r.post("/webhooks", async (req, res) => {
  const p = z.object({ url: z.string().url().max(500) }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: "validation" });
  const m = await merchantOf(req.user!.id);
  if ((await pool.query("SELECT count(*)::int n FROM webhooks WHERE merchant_id=$1 AND active", [m.id])).rows[0].n >= 5) return res.status(409).json({ error: "webhook_limit_reached" });
  try { await assertSafeUrl(p.data.url); } catch (e: any) { return res.status(400).json({ error: e.message }); }
  const secret = "whsec_" + crypto.randomBytes(24).toString("hex");
  const w = (await pool.query("INSERT INTO webhooks(merchant_id,url,signing_secret_enc) VALUES($1,$2,$3) RETURNING id,url,active", [m.id, p.data.url, encrypt(secret)])).rows[0];
  await audit(req.user!.id, "webhook.created", "webhook", w.id, { url: p.data.url }, req.ip);
  res.status(201).json({ ...w, secret, warning: "Store the signing secret now. It cannot be shown again." });
});
r.post("/webhooks/:id/deactivate", async (req, res) => {
  const m = await merchantOf(req.user!.id);
  const q = await pool.query("UPDATE webhooks SET active=false WHERE id=$1 AND merchant_id=$2 RETURNING id", [req.params.id, m.id]);
  q.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: "not_found" });
});
r.post("/webhooks/:id/test", async (req, res) => {
  const m = await merchantOf(req.user!.id);
  const w = (await pool.query("SELECT id FROM webhooks WHERE id=$1 AND merchant_id=$2 AND active", [req.params.id, m.id])).rows[0];
  if (!w) return res.status(404).json({ error: "not_found" });
  await enqueueTo(pool, w.id, "webhook.test", { id: crypto.randomUUID(), message: "Test event from HAKIM GLOBAL PAY" }); res.json({ ok: true });
});
r.get("/webhook-deliveries", async (req, res) => {
  const m = await merchantOf(req.user!.id);
  res.json((await pool.query("SELECT d.event_type,d.status,d.attempts,d.last_http_status,d.last_error,d.created_at,w.url FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE w.merchant_id=$1 ORDER BY d.created_at DESC LIMIT 30", [m.id])).rows);
});
export default r;
