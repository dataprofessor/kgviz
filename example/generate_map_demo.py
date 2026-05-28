#!/usr/bin/env python3
"""Generate embedding map demos (PCA / t-SNE) as standalone HTML."""

from __future__ import annotations

from pathlib import Path

from demo_graph import synthetic_corpus
from kgviz import Graph3D


def main() -> None:
    out_dir = Path(__file__).resolve().parent
    nodes, features = synthetic_corpus(400)

    for method in ("pca", "tsne"):
        fig = Graph3D.from_map(
            nodes,
            features,
            method=method,  # type: ignore[arg-type]
            knn_k=0,
            node_color_by="topic",
            legend_node_by="topic",
            height=700,
        )
        path = out_dir / f"demo_map_{method}.html"
        path.write_text(fig.to_html(), encoding="utf-8")
        print(f"Wrote {path}")

    print("Open: python3 example/serve_demo.py → http://127.0.0.1:8765/demo_map_tsne.html")


if __name__ == "__main__":
    main()
