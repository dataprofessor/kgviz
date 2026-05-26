# kgviz viewer

Browser-based 3D knowledge graph renderer for **kgviz**.

This folder is the **viewer** — a standalone React + Three.js HTML component. It owns all rendering, interaction, and WebGL logic. The Python package in `../kgviz/` is a thin wrapper that prepares graph data and embeds this viewer.

## What lives here

```
viewer/
├── src/
│   ├── index.tsx       # bootstrap: standalone embed OR Streamlit bridge
│   ├── KGVizView.tsx   # main 3D graph component
│   └── types.ts        # config contract shared with Python
├── index.html          # Vite dev entry
├── package.json
└── vite.config.ts
```

## Two run modes

### 1. Standalone embed (Jupyter, Gradio, Dash, plain HTML)

Python sets config before loading the bundle:

```html
<script>window.__KGVIZ_CONFIG__ = { graph_data: {...}, ... };</script>
<script type="module" src="assets/kgviz.js"></script>
<div id="root"></div>
```

The Python `Graph3D.to_html()` method generates this automatically.

### 2. Streamlit component

When `__KGVIZ_CONFIG__` is absent, the app boots in Streamlit mode via `streamlit-component-lib`, receiving args from the host app and sending click events back to Python.

## Development

```bash
cd viewer
npm install
npm run dev        # http://localhost:3001 — Streamlit dev mode
npm run build      # outputs viewer/build/ and copies to kgviz/_viewer/build/
```

### Streamlit dev loop

Terminal 1:
```bash
cd viewer && npm run dev
```

Terminal 2:
```bash
streamlit run example/app.py
```

## Config contract

The viewer expects a `ComponentArgs` object (see `src/types.ts`). Python builds this in `kgviz/figure.py` → `Graph3D.to_dict()`.

Key fields:
- `graph_data.nodes` — each node needs `id`; optional `label`, `color`, `size`, `x/y/z`
- `graph_data.edges` — each edge needs `source` and `target`
- styling keys: `node_color`, `node_size`, `dag_mode`, `warmup_ticks`, etc.

## Dependencies

- **react-force-graph-3d** — force-directed 3D layout
- **three** — WebGL rendering
- **streamlit-component-lib** — only used in Streamlit mode

## Build output

| Path | Purpose |
|---|---|
| `viewer/build/` | Primary build output (dev + source of truth) |
| `kgviz/_viewer/build/` | Copy consumed by the Python wheel / Streamlit `declare_component` |

Always run `npm run build` from this folder before publishing the Python package.
