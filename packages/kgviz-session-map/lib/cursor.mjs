import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { inferTopic } from "./topics.mjs";
import { truncate } from "./utils.mjs";

const USER_QUERY_RE = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/i;

async function walkJsonl(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "subagents") continue;
      await walkJsonl(p, out);
    } else if (e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

function extractText(record) {
  const msg = record.message;
  if (!msg || !Array.isArray(msg.content)) return "";
  return msg.content
    .filter(p => p?.type === "text" && p.text)
    .map(p => String(p.text).trim())
    .join("\n")
    .trim();
}

function userQuery(text) {
  const m = USER_QUERY_RE.exec(text);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

export async function discoverCursor(projectsRoot) {
  const files = [];
  const projects = await readdir(projectsRoot, { withFileTypes: true });
  for (const proj of projects) {
    if (!proj.isDirectory()) continue;
    const at = join(projectsRoot, proj.name, "agent-transcripts");
    try {
      await walkJsonl(at, files);
    } catch { /* no transcripts */ }
  }
  return files.sort();
}

export async function loadCursorTurns(paths, minChars = 24) {
  const nodes = [];
  for (const path of paths) {
    const parts = path.split(/[/\\]/);
    const atIdx = parts.indexOf("agent-transcripts");
    const project = atIdx > 0 ? parts[atIdx - 1] : "unknown";
    const parent = parts[parts.length - 2];
    const sessionId = parent === "agent-transcripts" ? path.split("/").pop().replace(".jsonl", "") : parent;
    const raw = await readFile(path, "utf8");
    let lineNo = 0;
    for (const line of raw.split("\n")) {
      lineNo++;
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      const role = String(record.role || "").toLowerCase();
      if (role !== "user" && role !== "assistant") continue;
      const text = extractText(record);
      if (text.length < minChars) continue;
      const display = role === "user" ? (userQuery(text) || text) : text;
      nodes.push({
        id: `cursor:${project}:${sessionId}:${lineNo}`,
        label: truncate(display),
        role: role.charAt(0).toUpperCase() + role.slice(1),
        session: `session ${sessionId.slice(0, 8)}…`,
        session_id: sessionId,
        project,
        source: "cursor",
        topic: inferTopic(display),
        text,
        line: lineNo,
      });
    }
  }
  return nodes;
}

export async function loadCursorSessions(paths, minChars = 24) {
  const byPath = new Map();
  for (const path of paths) {
    const turns = await loadCursorTurns([path], minChars);
    if (!turns.length) continue;
    const t = turns[0];
    const text = turns.map(n => n.text).join("\n\n").slice(0, 8000);
    byPath.set(path, {
      id: `cursor:${t.project}:${t.session_id}`,
      label: truncate(t.session),
      role: "Session",
      session: t.session,
      session_id: t.session_id,
      project: t.project,
      source: "cursor",
      topic: inferTopic(text),
      text,
      turn_count: turns.length,
    });
  }
  return [...byPath.values()];
}
