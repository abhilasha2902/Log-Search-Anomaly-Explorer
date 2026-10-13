import "./env.js";
import pino from "pino";
import { createApp } from "./app.js";
import { createPool } from "./db.js";

const logger = pino({
  redact: ["req.headers.authorization", "req.headers.cookie", "req.headers[\"x-api-key\"]", "password", "*.password"],
});
const port = Number(process.env.PORT ?? 3000);
const pool = createPool();
const app = createApp(pool);

app.listen(port, () => {
  logger.info(`api listening on port ${port}`);
});
