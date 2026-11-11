import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
export interface AuthUser { id: string; role: "merchant" | "admin"; }
declare global { namespace Express { interface Request { user?: AuthUser } } }
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return res.status(401).json({ error: "unauthorized" });
  try { req.user = jwt.verify(h.slice(7), process.env.JWT_ACCESS_SECRET!) as AuthUser; next(); }
  catch { res.status(401).json({ error: "invalid_token" }); }
}
export const requireRole = (role: "admin" | "merchant") => (req: Request, res: Response, next: NextFunction) =>
  req.user?.role === role ? next() : res.status(403).json({ error: "forbidden" });
