"""Shared sample graph and embedding-map demo data for framework examples."""

from __future__ import annotations

import random
from typing import Any

import numpy as np

NODES = [
    {"id": "A", "label": "Alpha", "color": "#ff6b6b", "size": 8},
    {"id": "B", "label": "Beta", "color": "#00cc88", "size": 6},
    {"id": "C", "label": "Gamma", "color": "#45b7d1", "size": 5},
    {"id": "D", "label": "Delta", "color": "#f0b429", "size": 4},
]
EDGES = [
    {"source": "A", "target": "B"},
    {"source": "B", "target": "C"},
    {"source": "C", "target": "D"},
    {"source": "A", "target": "D"},
]


def make_figure(**kwargs: Any):
    from kgviz import Graph3D

    opts: dict[str, Any] = {
        "nodes": NODES,
        "edges": EDGES,
        "show_labels": True,
        "height": 520,
    }
    opts.update(kwargs)
    return Graph3D(**opts)


def synthetic_corpus(n: int = 400, seed: int = 42) -> tuple[list[dict], np.ndarray]:
    """
    Clustered topic embeddings for map demos (``demo_map_tsne.html``, notebook, Streamlit).

    Each topic gets a distinct center in feature space so t-SNE forms separated islands.
    """
    rng = random.Random(seed)
    np_rng = np.random.default_rng(seed)
    topics = ["Physics", "Biology", "ML", "Math", "Chemistry"]
    nodes: list[dict] = []
    rows: list[np.ndarray] = []
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
    return nodes, np.vstack(rows)
