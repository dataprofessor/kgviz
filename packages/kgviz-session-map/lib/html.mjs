import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = dirname(dirname(fileURLToPath(import.meta.url)));

export async function toHtml(nodes, { height = 720, colorBy = "topic", method = "tsne" } = {}) {
  const bundlePath = join(PKG, "vendor", "kgviz.js");
  const bundleJs = await readFile(bundlePath, "utf8");
  const methodLabel = { tsne: "t-SNE", pca: "PCA", umap: "UMAP" }[method] || method;

  const config = {
    graph_data: { nodes, edges: [] },
    node_color: "color",
    node_size: 4,
    node_label: "label",
    legend_node_by: colorBy,
    show_legend: true,
    map_mode: true,
    layout_method: `${methodLabel} · Sessions`,
    use_coordinates: true,
    default_view: "2d",
    warmup_ticks: 0,
    show_labels: false,
    link_directional_arrow: false,
    show_nav_info: false,
    focus_hops: 2,
    enable_focus: true,
    enable_multi_select: true,
    performance_mode: "auto",
    height,
    theme: { backgroundColor: "#0e1117" },
  };

  const payload = JSON.stringify(config).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>kgviz session map</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; min-height: 100vh; overflow: hidden; background: #0e1117; }
    #root { min-height: 100vh; }
  </style>
</head>
<body>
  <div id="root" style="width:100%;height:100vh;margin:0;padding:0;overflow:hidden;background:#0e1117;"></div>
  <script>window.__KGVIZ_CONFIG__ = ${payload};</script>
  <script type="module">
${bundleJs}
  </script>
</body>
</html>`;
}
