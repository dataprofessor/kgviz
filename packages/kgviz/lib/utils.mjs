import { homedir } from "node:os";
import { join } from "node:path";

export const PALETTE = [
  "#F8766D", "#E68613", "#CD9600", "#ABA300", "#7CAE00", "#0CB702",
  "#00BE67", "#00C19A", "#00BFC4", "#00B8E7", "#00A9FF", "#8494FF",
  "#C77CFF", "#ED68ED", "#FF61CC", "#FF68A1",
];

export const DEFAULT_CORTEX = join(homedir(), ".snowflake", "cortex", "conversations");
export const DEFAULT_CURSOR = join(homedir(), ".cursor", "projects");
export const DEFAULT_CLAUDE = join(homedir(), ".claude", "projects");

export function truncate(s, max = 72) {
  const one = String(s).replace(/\s+/g, " ").trim();
  return one.length <= max ? one : one.slice(0, max - 1) + "…";
}

export function applyColors(nodes, field) {
  const vals = [...new Set(nodes.map(n => n[field]).filter(v => v != null))];
  const map = Object.fromEntries(vals.map((v, i) => [v, PALETTE[i % PALETTE.length]]));
  for (const n of nodes) n.color = map[n[field]] ?? "#cccccc";
  return nodes;
}

/** Center and uniformly scale layout coords to ~[-span, span] per axis (2D or 3D). */
export function scaleCoords(coords, targetSpan = 200) {
  const n = coords.length;
  if (!n) return [];
  const dim = Math.min(
    3,
    Math.max(2, ...coords.map(c => (Array.isArray(c) ? c.length : 0))),
  );
  const pts = coords.map(c => {
    const row = Array.isArray(c) ? c : [c];
    return [row[0] ?? 0, row[1] ?? 0, dim >= 3 ? row[2] ?? 0 : 0];
  });
  const center = [0, 0, 0];
  for (const p of pts) {
    for (let i = 0; i < dim; i++) center[i] += p[i];
  }
  for (let i = 0; i < dim; i++) center[i] /= n;
  let extent = 0;
  for (const p of pts) {
    for (let i = 0; i < dim; i++) {
      extent = Math.max(extent, Math.abs(p[i] - center[i]));
    }
  }
  extent = extent || 1;
  const s = targetSpan / extent;
  return pts.map(p => [
    (p[0] - center[0]) * s,
    (p[1] - center[1]) * s,
    (p[2] - center[2]) * s,
  ]);
}

export function attachCoords(nodes, coords) {
  for (let i = 0; i < nodes.length; i++) {
    const [x, y, z] = coords[i];
    nodes[i].x = x;
    nodes[i].y = y;
    nodes[i].z = z ?? 0;
    nodes[i].fx = x;
    nodes[i].fy = y;
    nodes[i].fz = z ?? 0;
  }
  return nodes;
}
