import { readFile } from "node:fs/promises";
import { applyColors } from "./utils.mjs";
import { buildHtml } from "./html.mjs";

export async function loadGraphInput(inputPath, { nodesPath, edgesPath } = {}) {
  const raw = JSON.parse(await readFile(inputPath, "utf8"));
  let nodes = raw.nodes ?? raw.graph_data?.nodes;
  let edges = raw.edges ?? raw.graph_data?.edges ?? [];
  const config = { ...raw };
  delete config.nodes;
  delete config.edges;
  delete config.graph_data;

  if (nodesPath) {
    const n = JSON.parse(await readFile(nodesPath, "utf8"));
    nodes = Array.isArray(n) ? n : n.nodes;
  }
  if (edgesPath) {
    const e = JSON.parse(await readFile(edgesPath, "utf8"));
    edges = Array.isArray(e) ? e : e.edges;
  }
  if (!Array.isArray(nodes) || !nodes.length) {
    throw new Error("Input must include a non-empty nodes array");
  }
  return { nodes, edges: edges || [], config };
}

export async function buildGraphHtml(inputPath, opts = {}) {
  const { nodes, edges, config } = await loadGraphInput(inputPath, opts);
  const colorBy = opts.colorBy ?? config.node_color_by ?? config.legend_node_by;
  if (colorBy) applyColors(nodes, colorBy);

  const hasCoords = nodes.some(n => n.x != null && n.y != null);
  return buildHtml({
    graph_data: { nodes, edges },
    map_mode: Boolean(opts.map ?? config.map_mode),
    use_coordinates: hasCoords || Boolean(opts.map ?? config.map_mode),
    show_legend: config.show_legend ?? Boolean(colorBy),
    legend_node_by: colorBy,
    node_color_by: undefined,
    height: opts.height ?? config.height ?? 720,
    show_labels: config.show_labels ?? false,
    default_view: config.default_view ?? (hasCoords ? "2d" : "3d"),
    ...config,
  });
}
