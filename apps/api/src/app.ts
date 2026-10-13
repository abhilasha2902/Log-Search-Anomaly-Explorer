import express, { type Express } from "express";
import type { Pool } from "pg";
import { createHealthHandler } from "./health.js";

export function createApp(pool: Pool): Express {
  const app = express();
  app.get("/health", createHealthHandler(pool));
  return app;
}
