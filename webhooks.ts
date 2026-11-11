import dns from "dns/promises"; import net from "net"; import crypto from "crypto";
import { pool } from "../db"; import { decrypt } from "./crypto";
type Db = { query: (q: string, p?: any[]) => Promise<any> };

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) { const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224; }
  const v = ip.toLowerCase(); if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
}
// SSRF guard: https only, no credentials, hostname must not resolve to a private/internal address.
export async function assertSafeUrl(raw: string): Promise<URL> {
  let u: URL; try { u = new URL(raw); } catch { throw new Error("invalid_url"); }
  const devOk = process.env.NODE_ENV !== "production" && process.env.WEBHOOK_ALLOW_PRIVATE === "true";
  if (u.protocol !== "https:" && !(devOk && u.protocol === "http:")) throw new Error("url_must_be_https");
  if (u.username || u.password) throw new Error("invalid_url");
  if (devOk) return u;
  const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("url_not_allowed");
  return u;
}
export const paymentData = (t: any, status: string, receipt?: string | null) => ({ id: t.id, status, amount_minor: Number(t.amount_minor), currency: t.currency, reference: t.merchant_reference || t.account_reference || null, receipt: receipt ?? t.provider_receipt ?? null });

export async function enqueueEvent(db: Db, merchantId: string, type: string, data: { id: string; [k: string]: any }) {
  const hooks = (await db.query("SELECT id FROM webhooks WHERE merchant_id=$1 AND active", [merchantId])).rows;
  for (const h of hooks) await enqueueTo(db, h.id, type, data);
}
export async function enqueueTo(db: Db, webhookId: string, type: string, data: { id: string; [k: string]: any }) {
  const eventId = `${type}:${data.id}`, payload = { id: eventId, type, created: new Date().toISOString(), data };
  await db.query("INSERT INTO webhook_deliveries(webhook_id,event_id,event_type,payload) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [webhookId, eventId, type, JSON.stringify(payload)]);
}
const BACKOFF_MIN = [1, 5, 30, 120, 720];
// Background worker: at-least-once delivery with signed payloads, retries with backoff, no redirects followed.
export async function deliverDue() {
  const rows = (await pool.query(`UPDATE webhook_deliveries SET next_attempt_at=now()+interval '2 minutes' WHERE id IN
    (SELECT id FROM webhook_deliveries WHERE status='pending' AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING *`)).rows;
  for (const d of rows) {
    let ok = false, code: number | null = null, err: string | null = null;
    try {
      const w = (await pool.query("SELECT * FROM webhooks WHERE id=$1", [d.webhook_id])).rows[0];
      if (!w || !w.active) throw new Error("webhook_inactive");
      await assertSafeUrl(w.url);
      const body = JSON.stringify(d.payload), ts = Math.floor(Date.now() / 1000);
      const sig = crypto.createHmac("sha256", decrypt(w.signing_secret_enc)).update(`${ts}.${body}`).digest("hex");
      const r = await fetch(w.url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(8000),
        headers: { "Content-Type": "application/json", "HGP-Event": d.event_type, "HGP-Signature": `t=${ts},v1=${sig}` }, body });
      code = r.status; ok = r.status >= 200 && r.status < 300; if (!ok) err = "http_" + r.status;
    } catch (e: any) { err = String(e.message || e).slice(0, 200); }
    const attempts = d.attempts + 1;
    if (ok) await pool.query("UPDATE webhook_deliveries SET status='delivered',attempts=$2,last_http_status=$3,last_error=NULL WHERE id=$1", [d.id, attempts, code]);
    else if (attempts > BACKOFF_MIN.length) await pool.query("UPDATE webhook_deliveries SET status='failed',attempts=$2,last_http_status=$3,last_error=$4 WHERE id=$1", [d.id, attempts, code, err]);
    else await pool.query("UPDATE webhook_deliveries SET attempts=$2,last_http_status=$3,last_error=$4,next_attempt_at=now()+($5||' minutes')::interval WHERE id=$1", [d.id, attempts, code, err, String(BACKOFF_MIN[attempts - 1])]);
  }
}
