API.require("admin", "/admin/login");
const row = (c) => "<tr>" + c.map((x) => "<td>" + x + "</td>").join("") + "</tr>";
const badge = (s) => `<span class="badge ${esc(s)}">${esc(s)}</span>`;
const table = (head, rows, empty) => rows.length ? "<table class=\"data-table\"><thead><tr>" + head.map((h) => "<th>" + h + "</th>").join("") + "</tr></thead><tbody>" + rows.join("") + "</tbody></table>" : `<p class="empty">${empty}</p>`;
const flash = (cls, t) => { $("#flash").innerHTML = `<div class="notice ${cls}">${esc(t)}</div>`; window.scrollTo({ top: 0 }); };
const d = (x) => new Date(x).toLocaleString(); const d_ = d;
async function act(fn, ok) { try { await fn(); flash("ok", ok); load(); } catch (e) { flash("error", friendly(e)); } }

async function load() {
  try {
    const [ms, txs, un, au, po, fe] = await Promise.all([API.get("/api/admin/merchants"), API.get("/api/admin/transactions"), API.get("/api/admin/unreconciled"), API.get("/api/admin/audit-logs"), API.get("/api/admin/payouts"), API.get("/api/admin/fees")]);
    $("#t-merchants").innerHTML = table(["Business", "Owner", "Email", "Verified", "Status", "KYC", "Ref", "Actions"], ms.map((m) => row([esc(m.business_name), esc(m.full_name), esc(m.email), m.email_verified ? "yes" : "no", badge(m.status), esc(m.kyc_status), esc(m.account_ref),
      (m.status !== "approved" ? `<button class="btn btn-primary small" data-m="approve" data-id="${esc(m.id)}">Approve</button> ` : `<button class="btn btn-secondary small" data-m="suspend" data-id="${esc(m.id)}">Suspend</button> `) +
      (m.kyc_status === "verified" ? "" : `<button class="btn btn-secondary small" data-kyc="verified" data-id="${esc(m.id)}">Mark KYC verified</button> `) + (m.email_verified ? "" : `<button class="btn btn-secondary small" data-m="verify-email" data-id="${esc(m.id)}">Mark email verified</button>`)])), "No merchants yet.");
    $("#settle-merchant").innerHTML = ms.filter((m) => m.status === "approved").map((m) => `<option value="${esc(m.id)}">${esc(m.business_name)}</option>`).join("");
    const bank = txs.filter((t) => t.provider_code === "bank_transfer" && t.status === "pending");
    $("#t-bank").innerHTML = table(["Date", "Merchant", "Reference", "Amount", "Confirm"], bank.map((t) => row([esc(d(t.created_at)), esc(t.business_name), "<code>" + esc(t.account_reference) + "</code>", esc(money(t.amount_minor, t.currency)),
      `<form class="inline" data-confirm="${esc(t.id)}"><input name="amt" type="number" step="0.01" min="0.01" placeholder="Amount received" required style="width:130px"/> <input name="ref" placeholder="Bank statement ref" required minlength="4" style="width:150px"/> <button class="btn btn-primary small" type="submit">Confirm received</button> <button class="btn btn-secondary small" type="button" data-reject="${esc(t.id)}">Reject</button></form>`])), "No pending bank transfers.");
    $("#t-tx").innerHTML = table(["Date", "Merchant", "Method", "Amount", "Status", "Receipt"], txs.map((t) => row([esc(d(t.created_at)), esc(t.business_name), esc(t.provider_code), esc(money(t.amount_minor, t.currency)), badge(t.status), esc(t.provider_receipt || "")])), "No transactions yet.");
    $("#t-alerts").innerHTML = table(["When", "Event", "Detail"], un.map((a) => row([esc(d(a.created_at)), esc(a.action), "<code>" + esc(JSON.stringify(a.meta || {})) + "</code>"])), "Nothing needs review.");
    $("#t-payouts").innerHTML = table(["Date", "Merchant", "Ref", "Pay to", "Amount", "Fee", "Status", "Action"], po.map((p) => { const d = p.destination || {}; const dest = p.method === "mpesa" ? "M-PESA " + (d.phone || "") : (d.bankName || "") + " · " + (d.accountName || "") + " · " + (d.accountNumber || "");
      return row([esc(d_(p.created_at)), esc(p.business_name), "<code>" + esc(p.reference) + "</code>", esc(dest), esc(money(p.amount * 100, p.currency)), esc(money(p.fee * 100, p.currency)), badge(p.status === "pending_approval" ? "pending" : p.status === "paid" ? "succeeded" : "failed") + " " + esc(p.status.replace("_", " ")),
        p.status === "pending_approval" ? `<form class="inline" data-paid="${esc(p.id)}"><input name="ref" placeholder="Payment reference" required minlength="4" style="width:150px"/> <button class="btn btn-primary small" type="submit">Mark paid</button> <button class="btn btn-secondary small" type="button" data-prej="${esc(p.id)}">Reject</button></form>` : esc(p.provider_ref || p.rejection_reason || "")]); }), "No payout requests.");
    $("#t-fees").innerHTML = table(["Method", "Currency", "Percent", "Fixed"], fe.map((f) => row([esc(f.kind), esc(f.currency), esc((f.percent_bps / 100).toFixed(2) + "%"), esc(money(f.fixed_minor, f.currency))])), "No fees set (withdrawals are free).");
    $("#t-audit").innerHTML = table(["When", "Action", "Entity", "IP"], au.map((a) => row([esc(d(a.created_at)), esc(a.action), esc((a.entity || "") + " " + (a.entity_id || "")), esc(a.ip || "")])), "No entries.");
  } catch (e) { if (e.status === 401 || e.status === 403) { API.clear(); location.href = "/admin/login"; } else flash("error", friendly(e)); }
}
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.dataset.m) act(() => API.post(`/api/admin/merchants/${t.dataset.id}/${t.dataset.m}`), "Done.");
  if (t.dataset.kyc) act(() => API.post(`/api/admin/merchants/${t.dataset.id}/kyc`, { status: t.dataset.kyc }), "KYC updated.");
  if (t.dataset.prej) { const reason = prompt("Reason for rejecting this payout (shown to the merchant):"); if (reason && reason.length >= 3) act(() => API.post(`/api/admin/payouts/${t.dataset.prej}/reject`, { reason }), "Payout rejected and funds returned."); }
  if (t.dataset.reject && confirm("Reject this bank transfer request?")) act(() => API.post(`/api/admin/transactions/${t.dataset.reject}/reject-bank`), "Rejected.");
  if (t.dataset.prov) { const [code, st] = t.dataset.prov.split(":"); act(() => API.post(`/api/admin/providers/${code}/${st}`), code + " " + st + "d."); }
  if (t.dataset.c2b) act(() => API.post("/api/admin/mpesa/register-c2b"), "C2B URLs registered with Safaricom.");
});
document.addEventListener("submit", (e) => {
  if (e.target.dataset.paid) { e.preventDefault(); const f = e.target; act(() => API.post(`/api/admin/payouts/${f.dataset.paid}/mark-paid`, { reference: f.ref.value }), "Payout marked as paid."); }
  if (e.target.id === "f-fee") { e.preventDefault(); const f = new FormData(e.target); act(() => API.call("PUT", "/api/admin/fees", { kind: f.get("kind"), currency: f.get("currency"), percent_bps: Number(f.get("bps")), fixed_minor: Math.round(Number(f.get("fixed")) * 100) }), "Fee saved."); }
  if (e.target.dataset.confirm) { e.preventDefault(); const f = e.target;
    act(() => API.post(`/api/admin/transactions/${f.dataset.confirm}/confirm-bank`, { bankReference: f.ref.value, receivedAmount: Number(f.amt.value) }), "Bank transfer confirmed and credited to pending balance."); }
});
$("#f-settle").addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target);
  act(() => API.post(`/api/admin/merchants/${f.get("merchant")}/settle`, { currency: f.get("currency"), amount: Number(f.get("amount")) }), "Settled."); });
$("#refresh").addEventListener("click", load); $("#logout").addEventListener("click", () => API.logout("/admin/login"));
load();
