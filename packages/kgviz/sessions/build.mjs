import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadCortexTurns, loadCortexSessions, discoverCortex } from "../lib/cortex.mjs";
import { loadCursorTurns, loadCursorSessions, discoverCursor } from "../lib/cursor.mjs";
import { loadClaudeTurns, loadClaudeSessions, discoverClaude } from "../lib/claude.mjs";
import { buildTfidfMatrix } from "../lib/tfidf.mjs";
import { assignLdaTopics } from "../lib/lda.mjs";
import { computeLayout } from "../lib/layout.mjs";
import { applyColors, attachCoords, DEFAULT_CORTEX, DEFAULT_CURSOR, DEFAULT_CLAUDE } from "../lib/utils.mjs";
import { mapHtml } from "../lib/html.mjs";

export async function buildSessions(opts) {
  let nodes = [];
  if (opts.source === "cortex" || opts.source === "all") {
    const paths = await discoverCortex(opts.cortexDir);
    console.log(`Cortex: ${paths.length} sessions`);
    nodes.push(...(opts.perSession
      ? await loadCortexSessions(paths, opts.cortexDir, opts.minChars)
      : await loadCortexTurns(paths, opts.cortexDir, opts.minChars)));
  }
  if (opts.source === "cursor" || opts.source === "all") {
    const paths = await discoverCursor(opts.cursorDir);
    console.log(`Cursor: ${paths.length} sessions`);
    nodes.push(...(opts.perSession
      ? await loadCursorSessions(paths, opts.minChars)
      : await loadCursorTurns(paths, opts.minChars)));
  }
  if (opts.source === "claude" || opts.source === "all") {
    const paths = await discoverClaude(opts.claudeDir);
    console.log(`Claude Code: ${paths.length} sessions`);
    nodes.push(...(opts.perSession
      ? await loadClaudeSessions(paths, opts.minChars)
      : await loadClaudeTurns(paths, opts.minChars)));
  }
  if (!nodes.length) {
    throw new Error("No conversation text found. Check --source and directory paths.");
  }

  if (opts.maxPoints > 0 && nodes.length > opts.maxPoints) {
    const step = Math.ceil(nodes.length / opts.maxPoints);
    nodes = nodes.filter((_, i) => i % step === 0).slice(0, opts.maxPoints);
    console.log(`Subsampled to ${nodes.length} points`);
  }

  const topicModel = opts.topicModel ?? "lda";
  if (topicModel === "lda") {
    const nTopics = opts.nTopics > 0 ? opts.nTopics : null;
    const ldaTopics = assignLdaTopics(nodes, { nTopics });
    console.log(`LDA topics (${Object.keys(ldaTopics).length}):`);
    for (const [idx, label] of Object.entries(ldaTopics).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      const count = nodes.filter(n => n.topic === label).length;
      console.log(`  [${idx}] ${label} (${count} sessions)`);
    }
  } else if (topicModel === "none" && opts.colorBy === "topic") {
    for (const n of nodes) n.topic = n.source ?? "unknown";
  }

  console.log(`Embedding ${nodes.length} points…`);
  const matrix = buildTfidfMatrix(nodes.map(n => n.text));
  console.log(`Layout (${opts.method})…`);
  const coords = await computeLayout(matrix, opts.method);
  attachCoords(nodes, coords);
  applyColors(nodes, opts.colorBy);

  const html = await mapHtml(nodes, { colorBy: opts.colorBy, method: opts.method });
  const out = resolve(opts.out);
  await writeFile(out, html, "utf8");
  console.log(`Wrote ${out} (${nodes.length} points)`);
  return out;
}

export const SESSION_DEFAULTS = {
  source: "cortex",
  cortexDir: DEFAULT_CORTEX,
  cursorDir: DEFAULT_CURSOR,
  claudeDir: DEFAULT_CLAUDE,
  out: "kgviz-map.html",
  method: "tsne",
  colorBy: "topic",
  topicModel: "lda",
  nTopics: 0,
  minChars: 24,
  maxPoints: 0,
  perSession: false,
};
