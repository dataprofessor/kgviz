"""Streamlit custom component integration."""

from __future__ import annotations

from kgviz._assets import get_build_dir
from kgviz.figure import Graph3D


def _get_component_func():
    import streamlit.components.v1 as components

    build_dir = str(get_build_dir())
    try:
        return components.declare_component("kgviz", path=build_dir)
    except Exception:
        return components.declare_component("kgviz", url="http://localhost:3001")


def render_streamlit(fig: Graph3D, *, key: str | None = None) -> dict | None:
    component_func = _get_component_func()
    return component_func(**fig.to_dict(), key=key, default=None)


def streamlit_chart(fig: Graph3D, *, key: str | None = None) -> dict | None:
    """Render a Graph3D in Streamlit (alias for render_streamlit)."""
    return render_streamlit(fig, key=key)
