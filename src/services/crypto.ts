import crypto from "crypto";
// AES-256-GCM for secrets we must be able to read back (webhook signing secrets). Key derived from ENCRYPTION_KEY.
const key = () => { const k = process.env.ENCRYPTION_KEY; if (!k || k.length < 16) throw new Error("ENCRYPTION_KEY not set (16+ chars)"); return crypto.createHash("sha256").update(k).digest(); };
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]); return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
export function decrypt(s: string): string {
  const [iv, tag, enc] = s.split(".").map((x) => Buffer.from(x, "base64")); const d = crypto.createDecipheriv("aes-256-gcm", key(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}
