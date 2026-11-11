const features = [
  ["Collect payments", "Accept M-PESA STK Push and bank transfers from one merchant dashboard."],
  ["Verified by callback", "A payment is marked successful only after a matching Safaricom callback or a confirmed bank credit."],
  ["Pending and settled balances", "Money is withdrawable only after it has actually settled to your account."],
  ["Audit trail", "Every approval, payment event and settlement is logged."],
  ["API keys", "Generate, rotate and revoke keys. Secrets are stored hashed and shown once."],
  ["Built to extend", "Card and other providers plug into the same adapter, without rebuilding the platform."]
];
const grid = document.getElementById("feature-grid");
if (grid) features.forEach(([t, b]) => { const a = document.createElement("article"); a.className = "feature-card"; const h = document.createElement("h3"); h.textContent = t; const p = document.createElement("p"); p.textContent = b; a.append(h, p); grid.append(a); });
const year = document.getElementById("year"); if (year) year.textContent = new Date().getFullYear();
