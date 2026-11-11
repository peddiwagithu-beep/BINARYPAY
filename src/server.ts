import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "node:path";
import callbacks from "./routes/callbacks";
import collect from "./routes/collect";
import { reconcilePending } from "./services/reconcile";
import v1 from "./routes/v1"; import publicRoutes from "./routes/public";
import payouts from "./routes/payouts"; import { deliverDue } from "./services/webhooks";
import auth from "./routes/auth";
import merchant from "./routes/merchant";
import admin from "./routes/admin";

for (const k of ["DATABASE_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"]) {
  if (!process.env[k]) throw new Error(`Missing env ${k}`);
}

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || false }));
app.use(express.json({ limit: "100kb" }));

const publicDir = path.resolve(__dirname, "../public");
app.use(express.static(publicDir));

app.get("/", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
app.get("/about", (_req, res) => res.sendFile(path.join(publicDir, "about.html")));
app.get("/contact", (_req, res) => res.sendFile(path.join(publicDir, "contact.html")));
app.get("/pay/:slug", (_req, res) => res.sendFile(path.join(publicDir, "pay.html")));
for (const f of ["register", "verify-email", "docs"]) app.get("/" + f, (_req, res) => res.sendFile(path.join(publicDir, f + ".html")));
app.get("/merchant", (_req, res) => res.redirect(302, "/merchant/login"));
app.get("/merchant/login", (_req, res) => res.sendFile(path.join(publicDir, "merchant-login.html")));
app.get("/merchant/dashboard", (_req, res) => res.sendFile(path.join(publicDir, "merchant-dashboard.html")));
app.get("/admin", (_req, res) => res.redirect(302, "/admin/login"));
app.get("/admin/login", (_req, res) => res.sendFile(path.join(publicDir, "admin-login.html")));
app.get("/admin/dashboard", (_req, res) => res.sendFile(path.join(publicDir, "admin-dashboard.html")));

app.use("/api/auth", rateLimit({ windowMs: 15 * 60_000, limit: 30 }), auth);
app.use("/api/merchant/collect", rateLimit({ windowMs: 60_000, limit: 30 }), collect);
app.use("/api/merchant/payouts", rateLimit({ windowMs: 60_000, limit: 20 }), payouts);
app.use("/api/merchant", rateLimit({ windowMs: 60_000, limit: 120 }), merchant);
app.use("/api/v1", v1);
app.use("/api/public", rateLimit({ windowMs: 60_000, limit: 60 }), publicRoutes);
app.use("/api/cb", rateLimit({ windowMs: 60_000, limit: 600 }), callbacks);
app.use("/api/admin", admin);

setInterval(() => deliverDue().catch((e) => console.error("webhook worker", e)), 10_000);
if (process.env.MPESA_CONSUMER_KEY) {
  setInterval(() => reconcilePending().catch(() => {}), 60_000);
}

app.get("/health", (_q, r) => r.json({ ok: true, service: "Hakim Global Pay" }));
app.listen(Number(process.env.PORT) || 4000, () => console.log("Hakim Global Pay API up"));
