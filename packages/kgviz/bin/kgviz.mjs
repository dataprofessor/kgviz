#!/usr/bin/env node
import { writeFile, readFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraphHtml } from "../lib/graph.mjs";
import { serve } from "../lib/serve.mjs";
import { buildSessions, SESSION_DEFAULTS } from "../sessions/build.mjs";

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await readFile(join(PKG_ROOT, "package.json"), "utf8"));
const VERSION = pkg.version;

function help() {
  console.log(`kgviz v${VERSION} — 3D knowledge graphs & embedding maps (npx CLI)

Usage:
  npx kgviz <command> [options]

Commands:
  build <graph.json>     Standalone HTML from nodes/edges JSON
  sessions               t-SNE / PCA map of Cortex + Cursor conversations
  serve <file.html>      Local static server (default port 8765)
  help                   Show this help

Graph build:
  npx kgviz build graph.json -o out.html
  npx kgviz build graph.json --map --color-by topic
  npx kgviz build --nodes nodes.json --edges edges.json -o out.html

Sessions map (Snowflake Cortex / Cursor):
  npx kgviz sessions --per-session -o sessions.html
  npx kgviz sessions --source all --color-by source
  npx kgviz sessions --source cortex --method pca

Serve:
  npx kgviz serve out.html --port 8765

Python (full t-SNE / UMAP, requires pip install "kgviz[maps]"):
  pip install "kgviz[maps]"
  python3 -c "from kgviz import Graph3D; ..."

Docs: https://github.com/dataprofessor/kgviz
`);
}

function parse(argv) {
  const cmd = argv[0] ?? "help";
  const opts = {
    command: ["build", "sessions", "serve", "help", "-h", "--help"].includes(cmd) ? cmd : "sessions",
    positional: [],
    out: "kgviz.html",
    port: 8765,
    open: false,
    map: false,
    colorBy: null,
    height: 720,
    ...SESSION_DEFAULTS,
  };

  let args = argv;
  if (!["build", "sessions", "serve", "help", "-h", "--help"].includes(cmd)) {
    opts.command = "sessions";
    args = argv;
  } else {
    args = argv.slice(1);
    if (cmd === "build" || cmd === "serve") {
      const pos = argv[1];
      if (pos && !pos.startsWith("-")) {
        opts.positional.push(pos);
        args = argv.slice(2);
      }
    }
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    if (a === "--out" || a === "-o") opts.out = next();
    else if (a === "--port" || a === "-p") opts.port = Number(next());
    else if (a === "--open") opts.open = true;
    else if (a === "--map") opts.map = true;
    else if (a === "--color-by") opts.colorBy = next();
    else if (a === "--height") opts.height = Number(next());
    else if (a === "--nodes") opts.nodesPath = next();
    else if (a === "--edges") opts.edgesPath = next();
    else if (a === "--source") opts.source = next();
    else if (a === "--cortex-dir") opts.cortexDir = resolve(next());
    else if (a === "--cursor-dir") opts.cursorDir = resolve(next());
    else if (a === "--method") opts.method = next();
    else if (a === "--min-chars") opts.minChars = Number(next());
    else if (a === "--max-points") opts.maxPoints = Number(next());
    else if (a === "--per-session") opts.perSession = true;
  }
  return opts;
}

async function openFile(path) {
  const { exec } = await import("node:child_process");
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} "${path}"`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length) {
    help();
    return;
  }
  const opts = parse(argv);

  if (opts.command === "help" || opts.command === "-h" || opts.command === "--help") {
    help();
    return;
  }

  if (opts.command === "serve") {
    await serve(opts.positional[0] ?? opts.out, opts.port);
    return;
  }

  if (opts.command === "build") {
    const input = opts.positional[0];
    if (!input) throw new Error("Usage: kgviz build <graph.json> [-o out.html]");
    const html = await buildGraphHtml(input, {
      nodesPath: opts.nodesPath,
      edgesPath: opts.edgesPath,
      map: opts.map,
      colorBy: opts.colorBy,
      height: opts.height,
    });
    const out = resolve(opts.out);
    await writeFile(out, html, "utf8");
    console.log(`Wrote ${out}`);
    if (opts.open) await openFile(out);
    return;
  }

  if (opts.command === "sessions") {
    await buildSessions(opts);
    if (opts.open) await openFile(resolve(opts.out));
    return;
  }

  help();
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
