import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "./jwt.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: { id: string };
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.token as string | undefined;
  if (!token) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub };
    next();
  } catch {
    res.status(401).json({ error: "unauthenticated" });
  }
}
