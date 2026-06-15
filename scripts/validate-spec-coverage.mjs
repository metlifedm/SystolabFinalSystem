import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = readFileSync(resolve(root, "apps/api/src/specCoverage.ts"), "utf8");
const allowed = new Set(["Implemented", "Partially Implemented", "Planned", "Deprecated"]);
const statuses = [...file.matchAll(/status:\s+"([^"]+)"/g)].map((match) => match[1]);

if (statuses.length === 0) {
  console.error("No specification coverage statuses found.");
  process.exit(1);
}

const invalid = statuses.filter((status) => !allowed.has(status));
if (invalid.length > 0) {
  console.error(`Invalid coverage statuses: ${invalid.join(", ")}`);
  process.exit(1);
}

console.log(`Validated ${statuses.length} SYSTOLAB specification coverage entries.`);
