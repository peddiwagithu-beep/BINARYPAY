(function () {
  const K = { a: "hgp_at", r: "hgp_rt", role: "hgp_role" };
  const API = {
    set(t) { localStorage.setItem(K.a, t.accessToken); localStorage.setItem(K.r, t.refreshToken); if (t.role) localStorage.setItem(K.role, t.role); },
    clear() { Object.values(K).forEach((k) => localStorage.removeItem(k)); },
    async refresh() {
      const rt = localStorage.getItem(K.r); if (!rt) return false;
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: rt }) });
      if (!r.ok) return false; API.set(await r.json()); return true;
    },
    async call(method, path, body, headers, retry = true) {
      const h = Object.assign({ "Content-Type": "application/json" }, headers || {}); const t = localStorage.getItem(K.a); if (t) h.Authorization = "Bearer " + t;
      const r = await fetch(path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 401 && retry && (await API.refresh())) return API.call(method, path, body, headers, false);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error || "request_failed"), { status: r.status, body: j });
      return j;
    },
    get: (p) => API.call("GET", p), post: (p, b, h) => API.call("POST", p, b || {}, h),
    require(role, loginUrl) { if (!localStorage.getItem(K.a) || localStorage.getItem(K.role) !== role) { API.clear(); location.href = loginUrl; } },
    async logout(loginUrl) { try { await API.post("/api/auth/logout", { refreshToken: localStorage.getItem(K.r) }); } catch (e) {} API.clear(); location.href = loginUrl; }
  };
  const MSG = { invalid_credentials: "Email or password is incorrect.", email_not_verified: "Verify your email first. Check your inbox for the link.", email_in_use: "An account with this email already exists.",
    merchant_not_approved: "Your account is waiting for approval.", provider_disabled: "This payment method is not enabled yet.", invalid_phone: "Enter a valid Safaricom number, for example 0712345678.",
    provider_error: "The payment provider rejected the request. Try again shortly.", kyc_required_for_live_keys: "Live keys need approved business verification.", amount_mismatch: "The received amount does not match the request.",
    bank_reference_already_used: "That bank reference was already used.", insufficient_pending_balance: "Not enough pending balance.", validation: "Check the form: some fields are missing or invalid.", not_pending: "This item is no longer pending.", insufficient_settled_balance: "Not enough settled balance (amount plus fee).", kyc_required_for_payouts: "Payouts need verified business details.", below_minimum_payout: "Amount is below the minimum payout.", bank_details_required: "Enter the bank name, account name and account number.", mpesa_kes_only: "M-PESA payouts are in KES only.", url_must_be_https: "The URL must start with https://", url_not_allowed: "That address is not allowed.", invalid_url: "Enter a valid URL.", webhook_limit_reached: "You can have at most 5 active endpoints.", reference_already_used: "That reference was already used." };
  window.API = API;
  window.friendly = (e) => MSG[e.message] || "Something went wrong (" + e.message + ").";
  window.esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  window.money = (minor, cur) => (cur || "KES") + " " + (Number(minor) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  window.$ = (s) => document.querySelector(s);
})();
