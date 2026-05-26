#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, "..");
const vendor = join(pkg, "vendor");

const candidates = [
  join(pkg, "../../kgviz/_viewer/build/assets/kgviz.js"),
  join(pkg, "../../viewer/build/assets/kgviz.js"),
];

mkdirSync(vendor, { recursive: true });
const src = candidates.find(p => existsSync(p));
if (!src) {
  console.error("Viewer bundle not found. Run: cd viewer && npm run build");
  process.exit(1);
}
copyFileSync(src, join(vendor, "kgviz.js"));
console.log(`Copied viewer bundle → ${join(vendor, "kgviz.js")}`);
