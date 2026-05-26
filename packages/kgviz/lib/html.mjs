import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = dirname(dirname(fileURLToPath(import.meta.url)));

const MAP_DEFAULTS = {
  map_mode: true,
  use_coordinates: true,
  default_view: "2d",
  warmup_ticks: 0,
  show_labels: false,
  link_directional_arrow: false,
  show_nav_info: false,
  layout_method: "Map",
};

const GRAPH_DEFAULTS = {
  map_mode: false,
  use_coordinates: false,
  default_view: "3d",
  warmup_ticks: 100,
  show_labels: false,
  link_directional_arrow: true,
  show_nav_info: false,
  focus_hops: 2,
  enable_focus: true,
  enable_multi_select: true,
};

export async function buildHtml(userConfig) {
  const bundleJs = await readFile(join(PKG, "vendor", "kgviz.js"), "utf8");
  const mapMode = Boolean(userConfig.map_mode);
  const base = mapMode ? MAP_DEFAULTS : GRAPH_DEFAULTS;

  const config = {
    graph_data: userConfig.graph_data || { nodes: [], edges: [] },
    node_color: userConfig.node_color ?? "color",
    node_size: userConfig.node_size ?? (mapMode ? 4 : "size"),
    node_label: userConfig.node_label ?? "label",
    edge_color: userConfig.edge_color ?? "#ffffff",
    edge_width: userConfig.edge_width ?? 1.5,
    legend_node_by: userConfig.legend_node_by ?? null,
    show_legend: userConfig.show_legend ?? false,
    performance_mode: userConfig.performance_mode ?? "auto",
    height: userConfig.height ?? 720,
    theme: userConfig.theme ?? { backgroundColor: "#0e1117" },
    ...base,
    ...userConfig,
    graph_data: userConfig.graph_data || { nodes: [], edges: [] },
  };

  const title = mapMode ? "kgviz map" : "kgviz graph";
  const payload = JSON.stringify(config).replace(/</g, "\\u003c");
  const bg = config.theme?.backgroundColor ?? "#0e1117";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; min-height: 100vh; overflow: hidden; background: ${bg}; }
    #root { min-height: 100vh; }
  </style>
</head>
<body>
  <div id="root" style="width:100%;height:100vh;margin:0;padding:0;overflow:hidden;background:${bg};"></div>
  <script>window.__KGVIZ_CONFIG__ = ${payload};</script>
  <script type="module">
${bundleJs}
  </script>
</body>
</html>`;
}

export async function mapHtml(nodes, opts = {}) {
  const methodLabel = { tsne: "t-SNE", pca: "PCA", umap: "UMAP" }[opts.method] || opts.method || "Map";
  return buildHtml({
    graph_data: { nodes, edges: [] },
    legend_node_by: opts.colorBy ?? "topic",
    show_legend: true,
    map_mode: true,
    layout_method: opts.layoutMethod ?? `${methodLabel} · Sessions`,
    use_coordinates: true,
    height: opts.height ?? 720,
  });
}
