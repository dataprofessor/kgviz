#!/usr/bin/env node
/**
 * @deprecated Use: npx kgviz sessions ...
 */
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
if (!argv.includes("--no-deprecation")) {
  console.warn("kgviz-session-map is deprecated. Use: npx kgviz sessions …");
}

const child = spawn("kgviz", ["sessions", ...argv], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
child.on("error", err => {
  if (err.code === "ENOENT") {
    console.error("kgviz CLI not found. Install: npm install -g kgviz");
    process.exit(1);
  }
  console.error(err.message || err);
  process.exit(1);
});
child.on("exit", code => process.exit(code ?? 1));
