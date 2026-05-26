#!/usr/bin/env python3
"""Generate a 1000-node kgviz HTML demo for performance testing."""

from __future__ import annotations

import math
import random
from pathlib import Path

from kgviz import Graph3D

N_NODES = 1000
N_COMMUNITIES = 12
EXTRA_EDGES_PER_NODE = 1
SEED = 42


def build_graph() -> tuple[list[dict], list[dict]]:
    random.seed(SEED)
    palette = [
        "#00A9FF", "#00C19A", "#C77CFF", "#F8766D", "#E68613", "#7CAE00",
        "#8494FF", "#FF61CC", "#00BFC4", "#ABA300", "#0CB702", "#ED68ED",
    ]
    nodes: list[dict] = []
    for i in range(N_NODES):
        community = i % N_COMMUNITIES
        angle = (2 * math.pi * i) / N_NODES
        ring_r = 280
        spread = 40 * (community % 5)
        nodes.append({
            "id": i,
            "label": f"N{i}",
            "color": palette[community % len(palette)],
            "size": 3 + (i % 5),
            "x": ring_r * math.cos(angle) + spread * math.cos(i * 0.17),
            "y": ring_r * math.sin(angle) + spread * math.sin(i * 0.23),
            "z": 30 * math.sin(i * 0.07) + (community - N_COMMUNITIES / 2) * 8,
        })

    edges: list[dict] = []
    seen: set[tuple[int, int]] = set()

    def add_edge(a: int, b: int) -> None:
        if a == b:
            return
        key = (a, b) if a < b else (b, a)
        if key in seen:
            return
        seen.add(key)
        edges.append({"source": a, "target": b})

    for i in range(N_NODES):
        add_edge(i, (i + 1) % N_NODES)
        add_edge(i, (i + N_NODES // 7) % N_NODES)
        for _ in range(EXTRA_EDGES_PER_NODE):
            j = random.randint(0, N_NODES - 1)
            add_edge(i, j)

    return nodes, edges


def main() -> None:
    nodes, edges = build_graph()
    out = Path(__file__).resolve().parent / "demo_1000.html"

    fig = Graph3D(
        nodes=nodes,
        edges=edges,
        show_labels=False,
        label_outline=False,
        link_directional_arrow=True,
        use_coordinates=True,
        warmup_ticks=0,
        default_view="3d",
        performance_mode="auto",
    )
    out.write_text(fig.to_html(), encoding="utf-8")
    print(f"Wrote {out}")
    print(f"  nodes={len(nodes)} edges={len(edges)}")
    print("  Open: python3 example/serve_demo.py --port 8765")
    print("  Then:  http://127.0.0.1:8765/demo_1000.html")


if __name__ == "__main__":
    main()
