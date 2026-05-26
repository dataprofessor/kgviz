"""Graph data normalization helpers."""

from __future__ import annotations

from typing import Any

_PALETTE = [
    "#F8766D",
    "#E68613",
    "#CD9600",
    "#ABA300",
    "#7CAE00",
    "#0CB702",
    "#00BE67",
    "#00C19A",
    "#00BFC4",
    "#00B8E7",
    "#00A9FF",
    "#8494FF",
    "#C77CFF",
    "#ED68ED",
    "#FF61CC",
    "#FF68A1",
]


def apply_color_by(nodes: list[dict], color_by: str, *, color_key: str = "color") -> list[dict]:
    unique_vals = list(dict.fromkeys(n.get(color_by) for n in nodes if color_by in n))
    color_map = {v: _PALETTE[i % len(_PALETTE)] for i, v in enumerate(unique_vals)}
    for n in nodes:
        n[color_key] = color_map.get(n.get(color_by), "#cccccc")
    return nodes


def apply_color_by_edges(edges: list[dict], color_by: str) -> list[dict]:
    return apply_color_by(edges, color_by, color_key="color")


_SIZE_ORDINALS: dict[str, float] = {
    "small": 0.0,
    "s": 0.0,
    "medium": 0.5,
    "med": 0.5,
    "m": 0.5,
    "large": 1.0,
    "l": 1.0,
}


def _coerce_size_value(raw: Any) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return float(raw)
    if isinstance(raw, str):
        key = raw.strip().lower()
        if key in _SIZE_ORDINALS:
            return _SIZE_ORDINALS[key]
        try:
            return float(key)
        except ValueError:
            return None
    return None


def apply_size_by(
    nodes: list[dict],
    size_by: str,
    size_range: tuple[float, float] = (3, 14),
) -> list[dict]:
    """Map a numeric (or small/medium/large) column to viewer ``size`` values."""
    lo_out, hi_out = size_range
    if lo_out > hi_out:
        lo_out, hi_out = hi_out, lo_out

    coerced: list[float | None] = [_coerce_size_value(n.get(size_by)) for n in nodes]
    numeric = [v for v in coerced if v is not None]
    default = (lo_out + hi_out) / 2

    if not numeric:
        for n in nodes:
            n["size"] = default
        return nodes

    lo_in = min(numeric)
    hi_in = max(numeric)

    for n, raw in zip(nodes, coerced):
        if raw is None:
            n["size"] = lo_out
        elif lo_in == hi_in:
            n["size"] = default
        else:
            t = (raw - lo_in) / (hi_in - lo_in)
            n["size"] = lo_out + t * (hi_out - lo_out)
    return nodes


def apply_width_by(
    edges: list[dict],
    width_by: str,
    width_range: tuple[float, float] = (0.5, 4.0),
) -> list[dict]:
    """Map a numeric edge column to viewer ``width`` values."""
    lo_out, hi_out = width_range
    if lo_out > hi_out:
        lo_out, hi_out = hi_out, lo_out

    coerced: list[float | None] = [_coerce_size_value(e.get(width_by)) for e in edges]
    numeric = [v for v in coerced if v is not None]
    default = (lo_out + hi_out) / 2

    if not numeric:
        for e in edges:
            e["width"] = default
        return edges

    lo_in = min(numeric)
    hi_in = max(numeric)

    for e, raw in zip(edges, coerced):
        if raw is None:
            e["width"] = lo_out
        elif lo_in == hi_in:
            e["width"] = default
        else:
            t = (raw - lo_in) / (hi_in - lo_in)
            e["width"] = lo_out + t * (hi_out - lo_out)
    return edges


def normalize_nodes(nodes: Any) -> list[dict]:
    try:
        import pandas as pd

        if isinstance(nodes, pd.DataFrame):
            if "id" not in nodes.columns:
                raise ValueError("Nodes DataFrame must have an 'id' column.")
            return nodes.to_dict(orient="records")
    except ImportError:
        pass

    if isinstance(nodes, list):
        for n in nodes:
            if "id" not in n:
                raise ValueError("Each node dict must have an 'id' key.")
        return nodes

    raise TypeError(f"Unsupported nodes type: {type(nodes)}")


def normalize_edges(edges: Any) -> list[dict]:
    try:
        import pandas as pd

        if isinstance(edges, pd.DataFrame):
            if "source" not in edges.columns or "target" not in edges.columns:
                raise ValueError(
                    "Edges DataFrame must have 'source' and 'target' columns."
                )
            return edges.to_dict(orient="records")
    except ImportError:
        pass

    if isinstance(edges, list):
        for e in edges:
            if "source" not in e or "target" not in e:
                raise ValueError(
                    "Each edge dict must have 'source' and 'target' keys."
                )
        return edges

    raise TypeError(f"Unsupported edges type: {type(edges)}")


def graph_from_networkx(graph: Any) -> tuple[list[dict], list[dict]]:
    nodes = []
    for node_id, attrs in graph.nodes(data=True):
        node = {"id": node_id, **attrs}
        if "label" not in node:
            node["label"] = str(node_id)
        nodes.append(node)

    edges = []
    for source, target, attrs in graph.edges(data=True):
        edges.append({"source": source, "target": target, **attrs})

    return nodes, edges


def apply_fixed_coordinates(nodes: list[dict]) -> list[dict]:
    for node in nodes:
        if "x" in node:
            node["fx"] = node["x"]
        if "y" in node:
            node["fy"] = node["y"]
        if "z" in node:
            node["fz"] = node["z"]
    return nodes
