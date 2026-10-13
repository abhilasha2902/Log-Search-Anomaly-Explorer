import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import type { Pool } from "pg";
import { createHealthHandler } from "./health.js";
import { createAuthRouter } from "./auth/routes.js";
import { requireAuth } from "./auth/middleware.js";

export function createApp(pool: Pool): Express {
  const app = express();
  app.use(
    cors({
      origin: (process.env.CORS_ORIGIN ?? "").split(",").filter(Boolean),
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  app.get("/health", createHealthHandler(pool));
  app.use("/auth", createAuthRouter(pool));

  app.get("/me", requireAuth, (req, res) => {
    res.status(200).json({ id: req.user?.id });
  });

  return app;
}
