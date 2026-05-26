#!/usr/bin/env python3
"""Generate embedding map demos (PCA / t-SNE) as standalone HTML."""

from __future__ import annotations

import random
from pathlib import Path

import numpy as np

from kgviz import Graph3D


def synthetic_corpus(n: int = 400, seed: int = 42) -> tuple[list[dict], np.ndarray]:
    rng = random.Random(seed)
    np_rng = np.random.default_rng(seed)
    topics = ["Physics", "Biology", "ML", "Math", "Chemistry"]
    nodes = []
    rows = []
    per = n // len(topics)
    for t_idx, topic in enumerate(topics):
        center = np_rng.normal(0, 1, 32) + t_idx * 2.5
        for i in range(per):
            title = f"{topic} paper {i}: {rng.randint(1000, 9999)}"
            nodes.append({
                "id": title,
                "label": title[:48] + ("…" if len(title) > 48 else ""),
                "topic": topic,
            })
            rows.append(center + np_rng.normal(0, 0.35, 32))
    features = np.vstack(rows)
    return nodes, features


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

    print("Open: python3 serve_demo.py → http://127.0.0.1:8765/demo_map_tsne.html")


if __name__ == "__main__":
    main()
