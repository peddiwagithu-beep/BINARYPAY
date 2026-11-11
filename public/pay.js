const slug = location.pathname.split("/").pop(); const card = $("#card");
const key = crypto.randomUUID();
async function pj(method, path, body) { const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || "failed"), { body: j }); return j; }
const ERR = { link_unavailable: "This payment link is not available.", invalid_phone: "Enter a valid Safaricom number, for example 0712345678.", too_many_attempts: "Too many attempts. Wait a few minutes and try again.", provider_error: "M-PESA could not send the prompt. Try again shortly.", provider_disabled: "Payments are temporarily unavailable.", merchant_not_approved: "This business cannot accept payments right now." };
(async () => {
  try {
    const l = await pj("GET", "/api/public/links/" + encodeURIComponent(slug));
    card.innerHTML = `<h1></h1><p id="desc"></p><form class="auth-form" id="f"><label>M-PESA phone number<input name="phone" inputmode="tel" placeholder="0712345678" required/></label>${l.amount == null ? '<label>Amount (KES)<input name="amount" type="number" min="1" step="1" required/></label>' : ""}<div id="msg" role="status"></div><button class="btn btn-primary full" type="submit"></button></form>`;
    card.querySelector("h1").textContent = "Pay " + l.businessName; $("#desc").textContent = l.description || "";
    card.querySelector("button").textContent = l.amount == null ? "Pay with M-PESA" : "Pay KES " + l.amount.toLocaleString() + " with M-PESA";
    $("#f").addEventListener("submit", async (e) => {
      e.preventDefault(); const f = new FormData(e.target), m = $("#msg"), b = e.target.querySelector("button"); b.disabled = true; m.className = ""; m.textContent = "";
      try {
        const r = await pj("POST", `/api/public/links/${encodeURIComponent(slug)}/pay`, { phone: f.get("phone"), amount: f.get("amount") ? Number(f.get("amount")) : undefined, key });
        m.className = "notice"; m.textContent = "Check your phone and enter your M-PESA PIN…";
        for (let i = 0; i < 30; i++) {
          await new Promise((x) => setTimeout(x, 3000)); const s = await pj("GET", "/api/public/payments/" + r.id);
          if (s.status === "succeeded") { card.innerHTML = '<h1>Payment received</h1><p>Thank you. M-PESA receipt: <strong id="rc"></strong></p>'; $("#rc").textContent = s.receipt; return; }
          if (s.status !== "pending") { m.className = "notice error"; m.textContent = "The payment was not completed."; b.disabled = false; return; }
        }
        m.textContent = "Still waiting for confirmation. If money was deducted, the business will see it shortly.";
      } catch (err) { m.className = "notice error"; m.textContent = ERR[err.message] || "Something went wrong. Please try again."; b.disabled = false; }
    });
  } catch (e) { card.innerHTML = "<h1>Link unavailable</h1><p>This payment link does not exist or is no longer active.</p>"; }
})();
