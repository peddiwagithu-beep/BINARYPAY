import { PaymentProvider } from "./types";
const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`Missing env ${k}`); return v; };
const base = () => ((process.env.MPESA_ENVIRONMENT || process.env.MPESA_ENV) === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke");
let cached: { v: string; exp: number } | null = null;
async function token(): Promise<string> {
  if (cached && cached.exp > Date.now()) return cached.v;
  const basic = Buffer.from(`${need("MPESA_CONSUMER_KEY")}:${need("MPESA_CONSUMER_SECRET")}`).toString("base64");
  const r = await fetch(`${base()}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${basic}` } });
  if (!r.ok) throw new Error(`daraja_auth_${r.status}`);
  const j: any = await r.json(); cached = { v: j.access_token, exp: Date.now() + (Number(j.expires_in || 3599) - 60) * 1000 }; return cached.v;
}
async function post(path: string, body: object): Promise<any> {
  const r = await fetch(`${base()}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify(body) });
  const j: any = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error("daraja_error"), { status: r.status, body: j }); return j;
}
export const serverEnvironment = (): "live" | "sandbox" => ((process.env.MPESA_ENVIRONMENT || process.env.MPESA_ENV) === "production" ? "live" : "sandbox");
export function normalizePhone(p: string): string {
  const d = p.replace(/[^\d]/g, "");
  if (/^254[17]\d{8}$/.test(d)) return d; if (/^0[17]\d{8}$/.test(d)) return "254" + d.slice(1); if (/^[17]\d{8}$/.test(d)) return "254" + d;
  throw new Error("invalid_phone");
}
const stamp = () => new Date(Date.now() + 3 * 3600e3).toISOString().replace(/[-T:]/g, "").slice(0, 14); // EAT
export const callbackBase = () => need("MPESA_CALLBACK_URL").replace(/\/$/, ""); // e.g. https://api.yourdomain.com/api/cb
const hook = (kind: string) => `${callbackBase()}/${need("MPESA_CALLBACK_SECRET")}/${kind}`;

export const mpesa: PaymentProvider = {
  code: "mpesa_daraja", supportedCurrencies: ["KES"],
  async collect(r) {
    const ts = stamp(), shortcode = need("MPESA_SHORTCODE");
    const j = await post("/mpesa/stkpush/v1/processrequest", {
      BusinessShortCode: shortcode, Password: Buffer.from(shortcode + need("MPESA_PASSKEY") + ts).toString("base64"), Timestamp: ts,
      TransactionType: "CustomerPayBillOnline", Amount: Math.round(r.amountMinor / 100), PartyA: normalizePhone(r.phone!), PartyB: shortcode,
      PhoneNumber: normalizePhone(r.phone!), CallBackURL: hook("stk"), AccountReference: r.reference.slice(0, 12), TransactionDesc: r.description.slice(0, 13) });
    if (String(j.ResponseCode) !== "0" || !j.CheckoutRequestID) throw Object.assign(new Error("stk_rejected"), { body: j });
    return { providerCheckoutId: j.CheckoutRequestID };
  } };
export async function stkQuery(checkoutId: string) {
  const ts = stamp(), shortcode = need("MPESA_SHORTCODE");
  return post("/mpesa/stkpushquery/v1/query", { BusinessShortCode: shortcode, Password: Buffer.from(shortcode + need("MPESA_PASSKEY") + ts).toString("base64"), Timestamp: ts, CheckoutRequestID: checkoutId });
}
// Verify path/version on your Daraja portal before running in production.
export const registerC2B = () => post("/mpesa/c2b/v2/registerurl", { ShortCode: need("MPESA_SHORTCODE"), ResponseType: "Cancelled", ConfirmationURL: hook("c2b/confirm"), ValidationURL: hook("c2b/validate") });
