import { homedir } from "node:os";
import { join } from "node:path";

export const PALETTE = [
  "#F8766D", "#E68613", "#CD9600", "#ABA300", "#7CAE00", "#0CB702",
  "#00BE67", "#00C19A", "#00BFC4", "#00B8E7", "#00A9FF", "#8494FF",
  "#C77CFF", "#ED68ED", "#FF61CC", "#FF68A1",
];

export const DEFAULT_CORTEX = join(homedir(), ".snowflake", "cortex", "conversations");
export const DEFAULT_CURSOR = join(homedir(), ".cursor", "projects");

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

export function scaleCoords(coords, targetSpan = 200) {
  const n = coords.length;
  if (!n) return [];
  let cx = 0;
  let cy = 0;
  for (const [x, y] of coords) {
    cx += x;
    cy += y;
  }
  cx /= n;
  cy /= n;
  let extent = 0;
  for (const [x, y] of coords) {
    extent = Math.max(extent, Math.abs(x - cx), Math.abs(y - cy));
  }
  extent = extent || 1;
  const s = targetSpan / extent;
  return coords.map(([x, y]) => [((x - cx) * s), ((y - cy) * s), 0]);
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
