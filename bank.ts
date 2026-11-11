// Bank transfer collection. Instructions come from env; success is confirmed ONLY by an administrator
// matching a real bank-statement credit (see POST /api/admin/transactions/:id/confirm-bank). Nothing is auto-confirmed.
export function bankInfo() {
  const e = process.env;
  if (!e.BANK_NAME || !e.BANK_ACCOUNT_NAME || !e.BANK_ACCOUNT_NUMBER) return null;
  return { bankName: e.BANK_NAME, accountName: e.BANK_ACCOUNT_NAME, accountNumber: e.BANK_ACCOUNT_NUMBER,
    branch: e.BANK_BRANCH || null, swift: e.BANK_SWIFT || null, currency: (e.BANK_CURRENCY || "KES").toUpperCase() };
}
