const role = document.currentScript.dataset.role;
const msg = $("#msg");
$("#login").addEventListener("submit", async (e) => {
  e.preventDefault(); msg.className = ""; msg.textContent = "";
  const f = new FormData(e.target);
  try {
    const t = await API.post("/api/auth/login", { email: f.get("email"), password: f.get("password") });
    if (t.role !== role) { msg.className = "notice error"; msg.textContent = role === "admin" ? "This account is not an administrator." : "Administrators sign in at /admin/login."; return; }
    API.set(t); location.href = role === "admin" ? "/admin/dashboard" : "/merchant/dashboard";
  } catch (err) { msg.className = "notice error"; msg.textContent = friendly(err); }
});
