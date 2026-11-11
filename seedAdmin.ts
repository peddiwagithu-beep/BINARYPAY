import "dotenv/config"; import bcrypt from "bcryptjs"; import { pool } from "../db";
(async () => { const { ADMIN_EMAIL: e, ADMIN_PASSWORD: p } = process.env; if (!e || !p || p.length < 12) throw new Error("Set ADMIN_EMAIL and a 12+ char ADMIN_PASSWORD");
  await pool.query("INSERT INTO users(email,password_hash,role,full_name,email_verified) VALUES($1,$2,'admin','Administrator',true) ON CONFLICT DO NOTHING", [e.toLowerCase(), await bcrypt.hash(p, 12)]);
  console.log("Admin ready"); await pool.end(); })();
