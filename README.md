# kgviz

3D knowledge graph visualization for Python — works like Plotly/Altair across Jupyter notebooks, Streamlit, Gradio, Dash, marimo, and plain HTML export.

**Repository:** [github.com/dataprofessor/kgviz](https://github.com/dataprofessor/kgviz)

## Project layout

```
kgviz/       Python wrapper — data prep, HTML export, framework adapters
viewer/      Browser component — React/Three.js 3D renderer (see viewer/README.md)
example/     Streamlit demo
AGENTS.md    Architecture guide for contributors and coding agents
```

## Install

```bash
pip install kgviz

# With framework extras
pip install "kgviz[all]"
```

## Quick start

```python
from kgviz import Graph3D, kgviz

nodes = [
    {"id": "A", "label": "Alpha", "color": "#ff0000", "size": 5},
    {"id": "B", "label": "Beta", "color": "#00ff00", "size": 4},
    {"id": "C", "label": "Gamma", "color": "#0000ff", "size": 3},
]
edges = [
    {"source": "A", "target": "B"},
    {"source": "B", "target": "C"},
]

fig = Graph3D(nodes=nodes, edges=edges, show_labels=True)
fig.show()          # Jupyter cell or browser
fig.to_html()       # embed anywhere
```

### Knowledge-graph preset

```python
from kgviz import Graph3D

fig = Graph3D.kg_preset(
    nodes=nodes,
    edges=edges,
    node_color_by="type",
    node_size_by="degree",
    edge_color_by="relation",
    edge_width_by="weight",
    edge_label="label",
    show_edge_labels=True,
    show_legend=True,
)
```

**Explorer features:** schema legend (click to filter), multi-property search, multi-select, double-click neighborhood focus, typed edge labels/colors/widths, selection events for Streamlit sidebars.

### Embedding maps (PCA, t-SNE, UMAP, SOM)

Cosmograph-style 2D scatter maps from feature vectors (paper embeddings, node attributes, etc.):

```bash
pip install "kgviz[maps]"   # numpy, scikit-learn, umap-learn, minisom
```

```python
from kgviz import Graph3D
import numpy as np

nodes = [{"id": i, "label": f"Doc {i}", "topic": i % 5} for i in range(200)]
features = np.random.randn(200, 32)   # or sentence-transformer embeddings

fig = Graph3D.from_map(
    nodes,
    features,
    method="tsne",          # pca | tsne | umap | som
    node_color_by="topic",  # or cluster from auto k-means
    knn_k=0,                # 3 for light KNN overlay like Topic Explorer
)
fig.show()
```

Lower-level API: `from kgviz.layouts import compute_layout, build_map_graph, apply_layout_to_nodes`.

**Large maps (10k–100k+ points):** `map_mode` draws points on a **canvas overlay** (2D scatter or 3D orbit). Performance tiers automatically reduce labels and effects on big datasets. Regular knowledge graphs still use the **Three.js** 3D renderer for force-directed layouts.

```bash
python3 example/generate_map_demo_large.py   # demo_map_10k.html, demo_map_50k.html
```

**Cortex conversations (t-SNE):** cluster Snowflake Cortex Code sessions from `~/.snowflake/cortex/conversations`:

```bash
python3 example/generate_map_demo_sessions.py
python3 serve_demo.py   # http://127.0.0.1:8765/demo_map_sessions_tsne.html
```

Options: `--per-session` (one point per session), `--color-by workspace`, `--method pca` for faster layout on large histories.

### npx CLI (no Python)

Publishable npm package: **`packages/kgviz`** → install as `kgviz` on npm.

```bash
npx kgviz help
npx kgviz build graph.json -o graph.html
npx kgviz sessions --per-session -o sessions.html
npx kgviz serve sessions.html
```

See [packages/kgviz/README.md](packages/kgviz/README.md). (`kgviz-session-map` is a deprecated alias for `kgviz sessions`.)

## Framework usage

### Jupyter / IPython

```python
fig  # auto-displays via _repr_html_
```

### Streamlit

```python
import streamlit as st
from kgviz import kgviz

click = kgviz(nodes=nodes, edges=edges, key="graph")
```

### Gradio

```python
import gradio as gr
from kgviz import Graph3D
from kgviz.integrations import gradio_html

fig = Graph3D(nodes=nodes, edges=edges)
gr.HTML(gradio_html(fig))
```

### Dash

```python
from kgviz import Graph3D
from kgviz.integrations import dash_iframe

fig = Graph3D(nodes=nodes, edges=edges)
layout = dash_iframe(fig, height=600)
```

## Standalone HTML demo

```bash
cd /path/to/kgviz
python3 serve_demo.py
```

Open **http://127.0.0.1:8765/demo.html** (must use `serve_demo.py` or `cd example` before `python3 -m http.server`).

## Development

```bash
cd viewer && npm install && npm run build
pip install -e ".[dev]"
streamlit run example/app.py
```

See [AGENTS.md](AGENTS.md) for the full architecture guide.
