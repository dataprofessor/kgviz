"""Shared sample graph for framework example apps."""

from __future__ import annotations

from typing import Any

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
