(async () => { const m = $("#msg"); const token = new URLSearchParams(location.search).get("token");
  try { await API.post("/api/auth/verify-email", { token }); m.className = "notice ok"; m.textContent = "Email verified. You can sign in."; }
  catch (e) { m.className = "notice error"; m.textContent = "This verification link is invalid or was already used."; } })();
