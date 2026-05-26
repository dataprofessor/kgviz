const RULES = [
  ["Map / 3D view", ["3d mode", "2d mode", "orbit", "pan", "zoom", "map_mode", "overlay"]],
  ["Labels & UI", ["show labels", "label", "toolbar", "widget", "button"]],
  ["Interaction", ["hover", "select", "click", "opacity", "node"]],
  ["Demo / server", ["demo server", "serve_demo", "browser", "playwright"]],
  ["Clustering", ["cluster", "pca", "tsne", "t-sne", "embedding"]],
  ["Streamlit", ["streamlit", "st.", "multipage"]],
  ["Snowflake / Cortex", ["snowflake", "cortex", "semantic view", "analyst", "warehouse"]],
  ["Build / dev", ["npm run build", "generate_map", "bundle", "viewer"]],
];

export function inferTopic(text) {
  const lower = String(text).toLowerCase();
  for (const [topic, keys] of RULES) {
    if (keys.some(k => lower.includes(k))) return topic;
  }
  if (lower.includes("kgviz") || lower.includes("forcegraph")) return "kgviz";
  return "General";
}
