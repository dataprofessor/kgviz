import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { inferTopic } from "./topics.mjs";
import { truncate } from "./utils.mjs";

const USER_QUERY_RE = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/i;

function recordRole(record) {
  const role = String(record.role || record.type || "").toLowerCase();
  if (role === "user" || role === "assistant") return role;
  const msg = record.message;
  if (msg && typeof msg === "object" && msg.role) {
    const inner = String(msg.role).toLowerCase();
    if (inner === "user" || inner === "assistant") return inner;
  }
  return "";
}

function extractText(record) {
  const msg = record.message;
  if (typeof msg === "string") return msg.trim();
  if (!msg || typeof msg !== "object") return "";
  const content = msg.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter(p => p?.type === "text" && p.text)
    .map(p => String(p.text).trim())
    .join("\n")
    .trim();
}

function userQuery(text) {
  const m = USER_QUERY_RE.exec(text);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

export async function discoverClaude(projectsRoot) {
  const files = [];
  const projects = await readdir(projectsRoot, { withFileTypes: true });
  for (const proj of projects) {
    if (!proj.isDirectory()) continue;
    const dir = join(projectsRoot, proj.name);
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".jsonl")) {
        files.push(join(dir, e.name));
      }
    }
  }
  return files.sort();
}

export async function loadClaudeTurns(paths, minChars = 24) {
  const nodes = [];
  for (const path of paths) {
    const parts = path.split(/[/\\]/);
    const idx = parts.indexOf("projects");
    const project = idx >= 0 && idx + 1 < parts.length ? parts[idx + 1] : "unknown";
    const sessionId = path.split(/[/\\]/).pop().replace(".jsonl", "");
    const raw = await readFile(path, "utf8");
    let lineNo = 0;
    for (const line of raw.split("\n")) {
      lineNo++;
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      const role = recordRole(record);
      if (role !== "user" && role !== "assistant") continue;
      const text = extractText(record);
      if (text.length < minChars) continue;
      const display = role === "user" ? (userQuery(text) || text) : text;
      nodes.push({
        id: `claude:${project}:${sessionId}:${lineNo}`,
        label: truncate(display),
        role: role.charAt(0).toUpperCase() + role.slice(1),
        session: `session ${sessionId.slice(0, 8)}…`,
        session_id: sessionId,
        project,
        source: "claude",
        topic: inferTopic(display),
        text,
        line: lineNo,
      });
    }
  }
  return nodes;
}

export async function loadClaudeSessions(paths, minChars = 24) {
  const byPath = new Map();
  for (const path of paths) {
    const turns = await loadClaudeTurns([path], minChars);
    if (!turns.length) continue;
    const t = turns[0];
    const text = turns.map(n => n.text).join("\n\n").slice(0, 8000);
    byPath.set(path, {
      id: `claude:${t.project}:${t.session_id}`,
      label: truncate(t.session),
      role: "Session",
      session: t.session,
      session_id: t.session_id,
      project: t.project,
      source: "claude",
      topic: inferTopic(text),
      text,
      turn_count: turns.length,
    });
  }
  return [...byPath.values()];
}
