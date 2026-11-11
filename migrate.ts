import "dotenv/config"; import fs from "fs"; import path from "path"; import { pool } from "../db";
(async () => {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  const d = path.join(__dirname, "../../migrations");
  for (const f of fs.readdirSync(d).sort()) {
    if ((await pool.query("SELECT 1 FROM schema_migrations WHERE name=$1", [f])).rowCount) continue;
    console.log("Applying", f); const c = await pool.connect();
    try { await c.query("BEGIN"); await c.query(fs.readFileSync(path.join(d, f), "utf8")); await c.query("INSERT INTO schema_migrations(name) VALUES($1)", [f]); await c.query("COMMIT"); }
    catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
