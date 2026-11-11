import { PoolClient } from "pg";
// Credits PENDING balance exactly once. Funds become withdrawable only after settlement moves them to settled_minor.
export async function creditPending(c: PoolClient, merchantId: string, currency: string, amountMinor: number) {
  await c.query("UPDATE merchant_accounts SET pending_minor = pending_minor + $1 WHERE merchant_id=$2 AND currency=$3", [amountMinor, merchantId, currency]);
}
