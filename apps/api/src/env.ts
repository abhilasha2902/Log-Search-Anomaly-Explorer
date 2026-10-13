import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
config({ path: path.join(repoRoot, ".env") });
