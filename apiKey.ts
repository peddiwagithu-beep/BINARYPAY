import { Request, Response, NextFunction } from "express"; import crypto from "crypto";
import { pool } from "../db"; import { serverEnvironment } from "../providers/mpesa";
// Authenticates `Authorization: Bearer hgp_sk_...`. Secrets are stored hashed. A key only works in the environment this server runs in
// (sandbox keys with Daraja sandbox, live keys with production), so sandbox keys can never trigger real money movement.
export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer hgp_sk_")) return res.status(401).json({ error: "invalid_api_key" });
  const hash = crypto.createHash("sha256").update(h.slice(7)).digest("hex");
  const k = (await pool.query("SELECT id,environment,merchant_id FROM api_credentials WHERE secret_hash=$1 AND revoked_at IS NULL", [hash])).rows[0];
  if (!k) return res.status(401).json({ error: "invalid_api_key" });
  const m = (await pool.query("SELECT * FROM merchants WHERE id=$1", [k.merchant_id])).rows[0];
  if (!m || m.status !== "approved") return res.status(403).json({ error: "merchant_not_approved" });
  if (k.environment !== serverEnvironment()) return res.status(403).json({ error: "environment_mismatch", detail: `This server accepts ${serverEnvironment()} keys.` });
  (req as any).apiMerchant = m;
  pool.query("UPDATE api_credentials SET last_used_at=now() WHERE id=$1", [k.id]).catch(() => {});
  res.on("finish", () => pool.query("INSERT INTO api_request_logs(credential_id,method,path,status) VALUES($1,$2,$3,$4)", [k.id, req.method, req.baseUrl + req.path, res.statusCode]).catch(() => {}));
  next();
}
