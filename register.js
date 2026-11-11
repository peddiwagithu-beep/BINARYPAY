$("#reg").addEventListener("submit", async (e) => {
  e.preventDefault(); const msg = $("#msg"); msg.className = ""; msg.textContent = "";
  const b = Object.fromEntries(new FormData(e.target)); if (!b.registrationNumber) delete b.registrationNumber;
  try { await API.post("/api/auth/register", b); e.target.hidden = true; msg.className = "notice ok"; msg.textContent = "Account created. Check your email to verify your address. An administrator will then review your account."; $(".auth-panel").append(msg); }
  catch (err) { msg.className = "notice error"; msg.textContent = friendly(err); }
});
