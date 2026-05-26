import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { inferTopic } from "./topics.mjs";
import { truncate } from "./utils.mjs";

const SYSTEM_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;
const MEMORY_RE = /<agent-memory>[\s\S]*?<\/agent-memory>/gi;
const CTX_RE = /\[Ctx Rule[^\]]*\][^\n]*/gi;

async function walk(dir, suffix, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, suffix, out);
    else if (e.name.endsWith(suffix)) out.push(p);
  }
  return out;
}

async function loadMeta(historyPath) {
  const sid = basename(historyPath).replace(".history.jsonl", "");
  const dir = dirname(historyPath);
  const candidates = [join(dir, `${sid}.json`)];
  for (const p of candidates) {
    try {
      const raw = await readFile(p, "utf8");
      return JSON.parse(raw);
    } catch { /* next */ }
  }
  return {};
}

function extractText(record) {
  const content = record.content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const item of content) {
    if (item?.type !== "text" || item.internalOnly) continue;
    let t = String(item.text || "");
    t = t.replace(SYSTEM_RE, "").replace(MEMORY_RE, "").replace(CTX_RE, "");
    t = t.replace(/\n{3,}/g, "\n\n").trim();
    if (t) parts.push(t);
  }
  return parts.join("\n").trim();
}

export async function discoverCortex(root) {
  return walk(root, ".history.jsonl");
}

export async function loadCortexTurns(historyPaths, root, minChars = 24) {
  const nodes = [];
  for (const historyPath of historyPaths) {
    const meta = await loadMeta(historyPath);
    const sessionId = meta.session_id || historyPath.split("/").pop().replace(".history.jsonl", "");
    let workspace = "default";
    try {
      const rel = relative(root, historyPath);
      const parts = rel.split(/[/\\]/);
      if (parts.length > 1) workspace = parts[0];
    } catch { /* noop */ }
    const title = meta.title || sessionId;
    const raw = await readFile(historyPath, "utf8");
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
      let topic = inferTopic(text);
      const wd = meta.working_directory || "";
      if (/streamlit/i.test(wd)) topic = "Streamlit";
      else if (/snowflake|cortex/i.test(wd) && topic === "General") topic = "Snowflake / Cortex";
      nodes.push({
        id: `cortex:${workspace}:${sessionId}:${lineNo}`,
        label: truncate(text.split("\n")[0]),
        role: role.charAt(0).toUpperCase() + role.slice(1),
        session: truncate(title, 48),
        session_id: sessionId,
        workspace,
        source: "cortex",
        topic,
        text,
        line: lineNo,
      });
    }
  }
  return nodes;
}

export async function loadCortexSessions(historyPaths, root, minChars = 24) {
  const nodes = [];
  for (const historyPath of historyPaths) {
    const meta = await loadMeta(historyPath);
    const sessionId = meta.session_id || historyPath.split("/").pop().replace(".history.jsonl", "");
    let workspace = "default";
    try {
      const rel = relative(root, historyPath);
      const parts = rel.split(/[/\\]/);
      if (parts.length > 1) workspace = parts[0];
    } catch { /* noop */ }
    const title = meta.title || sessionId;
    const chunks = [];
    let firstUser = "";
    const raw = await readFile(historyPath, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      const role = String(record.role || "").toLowerCase();
      if (role !== "user" && role !== "assistant") continue;
      const text = extractText(record);
      if (text.length < minChars) continue;
      if (role === "user" && !firstUser) firstUser = text.split("\n")[0];
      chunks.push(text);
    }
    if (!chunks.length) continue;
    const fullText = chunks.join("\n\n").slice(0, 8000);
    nodes.push({
      id: `cortex:${workspace}:${sessionId}`,
      label: truncate(title !== sessionId ? title : (firstUser || title)),
      role: "Session",
      session: truncate(title, 48),
      session_id: sessionId,
      workspace,
      source: "cortex",
      topic: inferTopic(fullText),
      text: fullText,
      turn_count: chunks.length,
    });
  }
  return nodes;
}
