// Sends mail through Resend's HTTP API. Without RESEND_API_KEY nothing is sent (logged only).
export async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  if (!key || !from) { console.log("MAIL not sent (set RESEND_API_KEY and MAIL_FROM):", to, subject); return false; }
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, subject, html }) });
  return r.ok;
}
