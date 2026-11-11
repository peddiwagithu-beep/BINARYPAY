# HAKIM GLOBAL PAY — Pay. Get Paid. Grow.
Payment technology platform (not a bank; no custody of customer funds without proper authorisation and settlement arrangements).

One Node/Express + PostgreSQL app that also serves the website and dashboards from `public/`.

## Run locally
cp .env.example .env   # fill DATABASE_URL, two JWT secrets, MPESA_CALLBACK_SECRET
npm install && npm run migrate && npm run seed:admin && npm run dev   # http://localhost:4000

## Deploy on Render
Create a Render PostgreSQL DB, then a Blueprint from this repo (render.yaml). Set the `sync:false` variables in the dashboard.
Set MPESA_CALLBACK_URL=https://YOUR-APP.onrender.com/api/cb  and APP_URL=https://YOUR-APP.onrender.com
Admin account: run `npm run seed:admin:prod` in the Render shell with ADMIN_EMAIL / ADMIN_PASSWORD set.

## Payment methods
- M-PESA STK Push + C2B via your Daraja Paybill (callback-verified, deduplicated, amount-checked).
- Bank transfer: payer gets your bank details + unique reference. An admin confirms against the real bank statement; amounts must match exactly.
Both credit the merchant's PENDING balance. An admin moves funds to SETTLED once money has really settled.
Add cards/other rails by implementing `src/providers/types.ts`.

## API keys and payment links
- Merchants create keys in the dashboard; call `/api/v1/payments`, `/payments/:id`, `/transactions`, `/balance`, `/payment-links` with `Authorization: Bearer hgp_sk_...` (see /docs).
- A key works only in the server's environment (sandbox keys with Daraja sandbox, live keys with production). Live keys need KYC marked verified by an admin.
- Payment links open a hosted page at /pay/<slug> (M-PESA STK Push), rate-limited per IP and per phone.

## Webhooks and payouts
- Webhooks: merchants add an HTTPS endpoint, get a signing secret once; events (payment.succeeded/failed, payout.paid/rejected) are POSTed with an HMAC-SHA256 `HGP-Signature`, retried with backoff. Private/internal addresses are blocked (SSRF guard). Needs ENCRYPTION_KEY.
- Payouts: settled funds only; amount + fee is held on request and refunded once if rejected. Admin sends the money manually and records the real reference (Daraja B2C is intentionally not automated until Safaricom approves it for your account).

## Routes
/ /register /merchant/login /merchant/dashboard /admin/login /admin/dashboard /docs /about /contact /pay/:slug
