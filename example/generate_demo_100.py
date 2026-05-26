#!/usr/bin/env python3
"""Generate a 100-node kgviz HTML demo."""

from __future__ import annotations

import math
import random
from pathlib import Path

from kgviz import Graph3D

N_NODES = 100
N_COMMUNITIES = 8
SPHERE_RADIUS = 200
NEIGHBORS_PER_NODE = 4
SEED = 42
GOLDEN_RATIO = (1 + math.sqrt(5)) / 2


def fibonacci_sphere(i: int, n: int, radius: float) -> tuple[float, float, float]:
    """Evenly distributed points on a sphere (Fibonacci / golden spiral)."""
    theta = 2 * math.pi * i / GOLDEN_RATIO
    phi = math.acos(1 - 2 * (i + 0.5) / n)
    r_sin = radius * math.sin(phi)
    return (
        r_sin * math.cos(theta),
        r_sin * math.sin(theta),
        radius * math.cos(phi),
    )


def build_graph() -> tuple[list[dict], list[dict]]:
    random.seed(SEED)
    palette = [
        "#00A9FF", "#00C19A", "#C77CFF", "#F8766D", "#E68613", "#7CAE00",
        "#8494FF", "#FF61CC", "#00BFC4", "#ABA300", "#0CB702", "#ED68ED",
    ]
    positions: list[tuple[float, float, float]] = [
        fibonacci_sphere(i, N_NODES, SPHERE_RADIUS) for i in range(N_NODES)
    ]

    nodes: list[dict] = []
    for i, (x, y, z) in enumerate(positions):
        community = int((math.atan2(y, x) + math.pi) / (2 * math.pi) * N_COMMUNITIES) % N_COMMUNITIES
        nodes.append({
            "id": i,
            "label": f"N{i}",
            "color": palette[community % len(palette)],
            "size": 4 + (i % 4),
            "x": x,
            "y": y,
            "z": z,
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
        xi, yi, zi = positions[i]
        neighbors = sorted(
            (
                (
                    j,
                    (positions[j][0] - xi) ** 2
                    + (positions[j][1] - yi) ** 2
                    + (positions[j][2] - zi) ** 2,
                )
                for j in range(N_NODES)
                if j != i
            ),
            key=lambda item: item[1],
        )
        for j, _ in neighbors[:NEIGHBORS_PER_NODE]:
            add_edge(i, j)

    return nodes, edges


def main() -> None:
    nodes, edges = build_graph()
    out = Path(__file__).resolve().parent / "demo_100.html"

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
    print("  Open: python3 serve_demo.py --port 8765")
    print("  Then:  http://127.0.0.1:8765/demo_100.html")


if __name__ == "__main__":
    main()
