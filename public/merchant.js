API.require("merchant", "/merchant/login");
let merchant = null, feeCfg = [];
const row = (cells) => "<tr>" + cells.map((c) => "<td>" + c + "</td>").join("") + "</tr>";
const badge = (s) => `<span class="badge ${esc(s)}">${esc(s)}</span>`;
const fmtDate = (d) => new Date(d).toLocaleString();

async function load() {
  try {
    merchant = (await API.get("/api/merchant/me")).merchant;
    $("#m-name").textContent = merchant.business_name; $("#m-status").textContent = merchant.status; $("#m-ref").textContent = merchant.account_ref;
    $("#gate").innerHTML = merchant.status === "approved" ? "" : '<div class="notice">Your account is <strong>' + esc(merchant.status) + "</strong>. You can collect payments once an administrator approves it.</div>";
    const [bal, stats, txs, keys, links, usage, pay, hooks, deliv, fees] = await Promise.all([API.get("/api/merchant/balance"), API.get("/api/merchant/stats"), API.get("/api/merchant/collect/transactions"), API.get("/api/merchant/api-keys"), API.get("/api/merchant/payment-links"), API.get("/api/merchant/api-usage"), API.get("/api/merchant/payouts"), API.get("/api/merchant/webhooks"), API.get("/api/merchant/webhook-deliveries"), API.get("/api/merchant/payouts/fees")]);
    feeCfg = fees; renderPayouts(pay); renderHooks(hooks, deliv); feeNote();
    renderStats(bal, stats); renderTx(txs); renderKeys(keys); renderLinks(links); renderUsage(usage);
  } catch (e) { if (e.status === 401 || e.status === 403) { API.clear(); location.href = "/merchant/login"; } else $("#gate").innerHTML = '<div class="notice error">' + esc(friendly(e)) + "</div>"; }
}
function renderStats(bal, stats) {
  const cards = [];
  bal.filter((b) => b.currency === "KES" || Number(b.pending_minor) || Number(b.settled_minor)).forEach((b) => {
    cards.push(["Pending balance " + b.currency, money(b.pending_minor, b.currency)], ["Settled balance " + b.currency, money(b.settled_minor, b.currency)]); });
  const n = (st) => stats.filter((s) => s.status === st).reduce((a, s) => a + s.count, 0);
  cards.push(["Successful payments", n("succeeded")], ["Pending payments", n("pending")], ["Failed or cancelled", n("failed") + n("cancelled")]);
  $("#overview").innerHTML = cards.map(([l, v]) => `<article class="stat-card"><span>${esc(l)}</span><strong>${esc(v)}</strong></article>`).join("");
}
function renderTx(txs) {
  $("#tx").innerHTML = txs.length ? '<table class="data-table"><thead><tr><th>Date</th><th>Method</th><th>Amount</th><th>Status</th><th>Receipt / reference</th></tr></thead><tbody>' +
    txs.map((t) => row([esc(fmtDate(t.created_at)), esc(t.provider_code === "bank_transfer" ? "Bank" : "M-PESA"), esc(money(t.amount_minor, t.currency)), badge(t.status), esc(t.provider_receipt || t.account_reference || "")])).join("") + "</tbody></table>"
    : '<p class="empty">No payments yet. Send an M-PESA prompt or request a bank transfer above.</p>';
}
function renderKeys(keys) {
  $("#keys-list").innerHTML = keys.length ? '<table class="data-table"><thead><tr><th>Label</th><th>Public key</th><th>Env</th><th>Secret ends</th><th>State</th><th></th></tr></thead><tbody>' +
    keys.map((k) => row([esc(k.label || "—"), "<code>" + esc(k.public_key) + "</code>", esc(k.environment), "…" + esc(k.secret_last4), k.revoked_at ? badge("revoked") : badge("approved"),
      k.revoked_at ? "" : `<button class="btn btn-secondary small" data-revoke="${esc(k.id)}">Revoke</button>`])).join("") + "</tbody></table>" : '<p class="empty">No keys yet.</p>';
}
function renderLinks(ls) {
  $("#links-list").innerHTML = ls.length ? '<table class="data-table"><thead><tr><th>For</th><th>Amount</th><th>Paid</th><th>State</th><th>Link</th></tr></thead><tbody>' +
    ls.map((l) => { const url = location.origin + l.url_path; return row([esc(l.description || l.reference), esc(l.amount == null ? "Customer chooses" : "KES " + l.amount.toLocaleString()), esc(l.paid), l.active ? badge("approved") : badge("revoked"),
      l.active ? `<code>${esc(url)}</code> <button class="btn btn-secondary small" data-copy="${esc(url)}">Copy</button> <button class="btn btn-secondary small" data-off="${esc(l.id)}">Turn off</button>` : ""]); }).join("") + "</tbody></table>" : '<p class="empty">No payment links yet.</p>';
}
function renderUsage(u) {
  $("#usage-list").innerHTML = u.length ? '<table class="data-table"><thead><tr><th>When</th><th>Request</th><th>Status</th><th>Key</th></tr></thead><tbody>' +
    u.map((x) => row([esc(fmtDate(x.created_at)), esc(x.method + " " + x.path), badge(x.status < 400 ? "succeeded" : "failed") + " " + esc(x.status), "<code>" + esc(x.public_key.slice(0, 22)) + "…</code>"])).join("") + "</tbody></table>" : '<p class="empty">No API requests yet.</p>';
}
$("#f-link").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = new FormData(e.target);
  try { await API.post("/api/merchant/payment-links", { description: f.get("description") || undefined, amount: f.get("amount") ? Number(f.get("amount")) : undefined }); e.target.reset(); $("#link-out").innerHTML = '<div class="notice ok">Payment link created.</div>'; load(); }
  catch (err) { $("#link-out").innerHTML = '<div class="notice error">' + esc(friendly(err)) + "</div>"; }
});
$("#links-list").addEventListener("click", async (e) => {
  if (e.target.dataset.copy) { try { await navigator.clipboard.writeText(e.target.dataset.copy); e.target.textContent = "Copied"; } catch (x) { prompt("Copy this link", e.target.dataset.copy); } }
  if (e.target.dataset.off && confirm("Turn this link off? Customers will no longer be able to pay.")) { try { await API.post("/api/merchant/payment-links/" + e.target.dataset.off + "/deactivate"); load(); } catch (err) { alert(friendly(err)); } }
});
function feeNote() {
  const f = $("#f-payout"); if (!f) return; const m = f.method.value, c = f.currency.value, x = feeCfg.find((q) => q.kind === "payout_" + m && q.currency === c);
  $("#fee-note").textContent = x && (x.percent_bps || Number(x.fixed_minor)) ? `Fee: ${(x.percent_bps / 100).toFixed(2)}% + ${money(x.fixed_minor, c)}` : "No withdrawal fee configured for this method.";
}
function renderPayouts(ps) {
  $("#payouts-list").innerHTML = ps.length ? '<table class="data-table"><thead><tr><th>Date</th><th>Ref</th><th>Method</th><th>Amount</th><th>Fee</th><th>Status</th><th>Note</th></tr></thead><tbody>' +
    ps.map((p) => row([esc(fmtDate(p.created_at)), "<code>" + esc(p.reference) + "</code>", esc(p.method), esc(money(p.amount * 100, p.currency)), esc(money(p.fee * 100, p.currency)),
      badge(p.status === "pending_approval" ? "pending" : p.status === "paid" ? "succeeded" : "failed") + " " + esc(p.status.replace("_", " ")), esc(p.rejection_reason || p.provider_ref || "")])).join("") + "</tbody></table>" : '<p class="empty">No payouts yet.</p>';
}
function renderHooks(hs, ds) {
  $("#hooks-list").innerHTML = hs.length ? '<table class="data-table"><thead><tr><th>URL</th><th>State</th><th></th></tr></thead><tbody>' +
    hs.map((h) => row(["<code>" + esc(h.url) + "</code>", h.active ? badge("approved") : badge("revoked"), h.active ? `<button class="btn btn-secondary small" data-test="${esc(h.id)}">Send test</button> <button class="btn btn-secondary small" data-hoff="${esc(h.id)}">Remove</button>` : ""])).join("") + "</tbody></table>" : '<p class="empty">No webhook endpoints yet.</p>';
  $("#deliv-list").innerHTML = ds.length ? '<table class="data-table"><thead><tr><th>When</th><th>Event</th><th>Status</th><th>Tries</th><th>Result</th></tr></thead><tbody>' +
    ds.map((d) => row([esc(fmtDate(d.created_at)), esc(d.event_type), badge(d.status === "delivered" ? "succeeded" : d.status === "failed" ? "failed" : "pending") + " " + esc(d.status), esc(d.attempts), esc(d.last_error || d.last_http_status || "")])).join("") + "</tbody></table>" : '<p class="empty">No deliveries yet.</p>';
}
const pf = $("#f-payout");
function pformSync() { const m = pf.method.value; pf.querySelectorAll("[data-for]").forEach((el) => { el.hidden = el.dataset.for !== m; }); if (m === "mpesa") pf.currency.value = "KES"; feeNote(); }
pf.method.addEventListener("change", pformSync); pf.currency.addEventListener("change", feeNote);
pf.addEventListener("submit", async (e) => {
  e.preventDefault(); const f = new FormData(e.target), method = f.get("method"); const o = $("#payout-out");
  const destination = method === "mpesa" ? { phone: f.get("phone") } : { bankName: f.get("bankName"), accountName: f.get("accountName"), accountNumber: f.get("accountNumber") };
  try { const r = await API.post("/api/merchant/payouts", { method, currency: f.get("currency"), amount: Number(f.get("amount")), destination }, { "Idempotency-Key": crypto.randomUUID() });
    o.innerHTML = '<div class="notice ok">Payout ' + esc(r.reference) + " requested. It is pending administrator processing.</div>"; e.target.reset(); pformSync(); pformSync();
load();
  } catch (err) { o.innerHTML = '<div class="notice error">' + esc(friendly(err)) + "</div>"; }
});
$("#f-hook").addEventListener("submit", async (e) => {
  e.preventDefault(); const o = $("#hook-out");
  try { const w = await API.post("/api/merchant/webhooks", { url: new FormData(e.target).get("url") }); e.target.reset();
    o.innerHTML = `<div class="notice ok"><strong>Copy your signing secret now. It is shown once.</strong><br><code>${esc(w.secret)}</code></div>`; pformSync();
load();
  } catch (err) { o.innerHTML = '<div class="notice error">' + esc(friendly(err)) + "</div>"; }
});
$("#hooks-list").addEventListener("click", async (e) => {
  try { if (e.target.dataset.test) { await API.post("/api/merchant/webhooks/" + e.target.dataset.test + "/test"); $("#hook-out").innerHTML = '<div class="notice ok">Test event queued. It is sent within about 10 seconds.</div>'; }
    if (e.target.dataset.hoff && confirm("Remove this endpoint?")) { await API.post("/api/merchant/webhooks/" + e.target.dataset.hoff + "/deactivate"); load(); } } catch (err) { alert(friendly(err)); }
});
// tabs
document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", x === b ? "true" : "false"));
  $("#f-mpesa").hidden = b.dataset.tab !== "mpesa"; $("#f-bank").hidden = b.dataset.tab !== "bank"; $("#collect-out").innerHTML = "";
}));
const out = (cls, html) => { $("#collect-out").innerHTML = `<div class="notice ${cls}">${html}</div>`; };

$("#f-mpesa").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = new FormData(e.target); const btn = e.target.querySelector("button"); btn.disabled = true;
  try {
    const r = await API.post("/api/merchant/collect/mpesa/stk", { phone: f.get("phone"), amount: Number(f.get("amount")) }, { "Idempotency-Key": crypto.randomUUID() });
    out("", "Prompt sent. Ask the customer to enter their M-PESA PIN. Waiting for confirmation…");
    for (let i = 0; i < 30; i++) {
      await new Promise((r2) => setTimeout(r2, 3000));
      const t = await API.get("/api/merchant/collect/transactions/" + r.id);
      if (t.status === "succeeded") { out("ok", "Payment received. M-PESA receipt <strong>" + esc(t.provider_receipt) + "</strong>."); break; }
      if (t.status !== "pending") { out("error", "Payment " + esc(t.status) + ". The customer did not complete it."); break; }
      if (i === 29) out("", "Still waiting. The result will appear in Transactions once Safaricom confirms.");
    }
  } catch (err) { out("error", esc(friendly(err))); } finally { btn.disabled = false; load(); }
});
$("#f-bank").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = new FormData(e.target);
  try {
    const r = await API.post("/api/merchant/collect/bank", { amount: Number(f.get("amount")), merchantReference: f.get("merchantReference") || undefined });
    const i = r.instructions;
    out("", `<strong>Pay ${esc(money(r.amount * 100, r.currency))} by bank transfer</strong><br>Bank: ${esc(i.bankName)}<br>Account name: ${esc(i.accountName)}<br>Account number: ${esc(i.accountNumber)}` +
      (i.branch ? "<br>Branch: " + esc(i.branch) : "") + (i.swift ? "<br>SWIFT: " + esc(i.swift) : "") + `<br><strong>Reference (must be quoted): ${esc(r.reference)}</strong><br>The payment shows as pending until the bank credit is verified.`);
  } catch (err) { out("error", esc(friendly(err))); } finally { load(); }
});
$("#f-key").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = new FormData(e.target);
  try { const k = await API.post("/api/merchant/api-keys", { label: f.get("label") || undefined, environment: f.get("environment") });
    $("#key-out").innerHTML = `<div class="notice ok"><strong>Copy your secret key now. It is shown once.</strong><br>Public: <code>${esc(k.publicKey)}</code><br>Secret: <code>${esc(k.secretKey)}</code></div>`; pformSync();
load();
  } catch (err) { $("#key-out").innerHTML = `<div class="notice error">${esc(friendly(err))}</div>`; }
});
$("#keys-list").addEventListener("click", async (e) => { const id = e.target.dataset.revoke; if (!id || !confirm("Revoke this key? Apps using it will stop working.")) return; try { await API.post("/api/merchant/api-keys/" + id + "/revoke"); load(); } catch (err) { alert(friendly(err)); } });
$("#refresh").addEventListener("click", load); $("#logout").addEventListener("click", () => API.logout("/merchant/login"));
pformSync();
load();
