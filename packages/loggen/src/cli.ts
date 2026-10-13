import { writeFileSync } from "node:fs";
import { generate } from "./generator.js";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      args[arg.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const seed = Number(args.seed ?? 42);
const count = Number(args.count ?? 5000);
const out = args.out ?? "logs.json";
const truth = args.truth ?? "truth.json";

const { events, groundTruth } = generate({ seed, count });

writeFileSync(out, JSON.stringify(events, null, 2));
writeFileSync(truth, JSON.stringify(groundTruth, null, 2));

console.log(`Wrote ${events.length} events to ${out} and ground truth to ${truth} (seed=${seed})`);
