import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import type { Pool } from "pg";
import { createHealthHandler } from "./health.js";
import { createAuthRouter } from "./auth/routes.js";
import { requireAuth } from "./auth/middleware.js";
import { createProjectsRouter } from "./projects/routes.js";
import { createIngestRouter } from "./ingest/routes.js";
import { createSearchRouter } from "./search/routes.js";
import { createTemplatesRouter } from "./templates/routes.js";
import { createAnomaliesRouter } from "./anomalies/routes.js";
import { errorHandler } from "./http.js";

export function createApp(pool: Pool): Express {
  const app = express();
  app.use(
    cors({
      origin: (process.env.CORS_ORIGIN ?? "").split(",").filter(Boolean),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/health", createHealthHandler(pool));
  app.use("/auth", createAuthRouter(pool));
  app.use("/projects", createProjectsRouter(pool));
  app.use("/projects", createSearchRouter(pool));
  app.use("/projects", createTemplatesRouter(pool));
  app.use("/projects", createAnomaliesRouter(pool));
  app.use("/ingest", createIngestRouter(pool));

  app.get("/me", requireAuth, (req, res) => {
    res.status(200).json({ id: req.user?.id });
  });

  app.use(errorHandler);

  return app;
}
