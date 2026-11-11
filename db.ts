import { Pool, PoolClient } from "pg";
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const r = await fn(c); await c.query("COMMIT"); return r; }
  catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
export const audit = (actor: string | null, action: string, entity?: string, id?: string, meta?: object, ip?: string) =>
  pool.query("INSERT INTO audit_logs(actor_user_id,action,entity,entity_id,meta,ip) VALUES($1,$2,$3,$4,$5,$6)",
    [actor, action, entity, id, meta ? JSON.stringify(meta) : null, ip]);
