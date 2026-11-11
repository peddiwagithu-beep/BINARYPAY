import { Router } from "express";
import bcrypt from "bcryptjs"; import jwt from "jsonwebtoken"; import crypto from "crypto"; import { z } from "zod";
import { pool, tx, audit } from "../db"; import { sendMail } from "../services/mail";
const r = Router();
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const reg = z.object({
  email: z.string().email(), password: z.string().min(10), fullName: z.string().min(2), phone: z.string().min(7),
  businessName: z.string().min(2), country: z.string().length(2), category: z.string().min(2), registrationNumber: z.string().optional() });

r.post("/register", async (req, res) => {
  const p = reg.safeParse(req.body); if (!p.success) return res.status(400).json({ error: "validation", details: p.error.flatten() });
  const d = p.data; const token = crypto.randomBytes(32).toString("hex");
  try {
    const out = await tx(async (c) => {
      const u = await c.query("INSERT INTO users(email,password_hash,full_name,phone,verify_token_hash) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [d.email.toLowerCase(), await bcrypt.hash(d.password, 12), d.fullName, d.phone, sha(token)]);
      const m = await c.query("INSERT INTO merchants(owner_user_id,business_name,country,category,registration_number,account_ref) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
        [u.rows[0].id, d.businessName, d.country.toUpperCase(), d.category, d.registrationNumber, "HGP" + crypto.randomBytes(4).toString("hex").toUpperCase()]);
      for (const cur of ["KES", "USD", "EUR", "GBP"]) await c.query("INSERT INTO merchant_accounts(merchant_id,currency) VALUES($1,$2)", [m.rows[0].id, cur]);
      return { userId: u.rows[0].id, merchantId: m.rows[0].id };
    });
    await audit(out.userId, "merchant.registered", "merchant", out.merchantId, {}, req.ip);
    const link = `${process.env.APP_URL || ""}/verify-email?token=${token}`;
    const sent = await sendMail(d.email, "Verify your HAKIM GLOBAL PAY email", `<p>Welcome to HAKIM GLOBAL PAY.</p><p><a href="${link}">Verify your email</a></p>`);
    if (!sent && process.env.NODE_ENV !== "production") console.log("DEV verify link:", link);
    res.status(201).json({ message: "Registered. Verify your email; an administrator must approve your account." });
  } catch (e: any) { res.status(e.code === "23505" ? 409 : 500).json({ error: e.code === "23505" ? "email_in_use" : "server_error" }); }
});

r.post("/verify-email", async (req, res) => {
  const t = String(req.body.token || "");
  const q = await pool.query("UPDATE users SET email_verified=true, verify_token_hash=NULL WHERE verify_token_hash=$1 RETURNING id", [sha(t)]);
  q.rowCount ? res.json({ ok: true }) : res.status(400).json({ error: "invalid_token" });
});

async function issue(userId: string, role: string) {
  const access = jwt.sign({ id: userId, role }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "15m" });
  const refresh = crypto.randomBytes(48).toString("hex");
  await pool.query("INSERT INTO refresh_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 days')", [userId, sha(refresh)]);
  return { accessToken: access, refreshToken: refresh };
}

r.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const u = (await pool.query("SELECT * FROM users WHERE email=$1", [String(email || "").toLowerCase()])).rows[0];
  if (!u || !(await bcrypt.compare(String(password || ""), u.password_hash)) || u.status !== "active")
    return res.status(401).json({ error: "invalid_credentials" });
  if (!u.email_verified) return res.status(403).json({ error: "email_not_verified" });
  await audit(u.id, "auth.login", "user", u.id, {}, req.ip);
  res.json({ ...(await issue(u.id, u.role)), role: u.role });
});

// Refresh-token rotation: old token is revoked on use.
r.post("/refresh", async (req, res) => {
  const h = sha(String(req.body.refreshToken || ""));
  const row = (await pool.query("UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() RETURNING user_id", [h])).rows[0];
  if (!row) return res.status(401).json({ error: "invalid_refresh" });
  const u = (await pool.query("SELECT id,role FROM users WHERE id=$1 AND status='active'", [row.user_id])).rows[0];
  u ? res.json(await issue(u.id, u.role)) : res.status(401).json({ error: "invalid_refresh" });
});
r.post("/logout", async (req, res) => {
  await pool.query("UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1", [sha(String(req.body.refreshToken || ""))]); res.json({ ok: true });
});
export default r;
