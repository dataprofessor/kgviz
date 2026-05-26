#!/usr/bin/env python3
"""Generate large embedding map demos (WebGL instanced points)."""

from __future__ import annotations

import random
from pathlib import Path

import numpy as np

from kgviz import Graph3D


def synthetic_corpus(n: int, seed: int = 7) -> tuple[list[dict], np.ndarray]:
    rng = random.Random(seed)
    np_rng = np.random.default_rng(seed)
    topics = [f"Topic_{i}" for i in range(12)]
    nodes = []
    rows = []
    per = max(1, n // len(topics))
    for t_idx, topic in enumerate(topics):
        center = np_rng.normal(0, 1, 48) + t_idx * 1.8
        for i in range(per):
            if len(nodes) >= n:
                break
            pid = len(nodes)
            nodes.append({
                "id": pid,
                "label": f"{topic} doc {i}",
                "topic": topic,
            })
            rows.append(center + np_rng.normal(0, 0.45, 48))
    return nodes, np.vstack(rows[: len(nodes)])


def main() -> None:
    out_dir = Path(__file__).resolve().parent
    for count, name in ((10_000, "10k"), (50_000, "50k")):
        print(f"Building {count} nodes (PCA)…")
        nodes, features = synthetic_corpus(count)
        fig = Graph3D.from_map(
            nodes,
            features,
            method="pca",
            knn_k=0,
            node_color_by="topic",
            legend_node_by="topic",
            instanced_map_threshold=1500,
            height=700,
        )
        path = out_dir / f"demo_map_{name}.html"
        path.write_text(fig.to_html(), encoding="utf-8")
        print(f"  Wrote {path} ({path.stat().st_size // 1024} KB)")

    print("Serve: python3 serve_demo.py → http://127.0.0.1:8765/demo_map_50k.html")


if __name__ == "__main__":
    main()
