"""Thin helpers for popular Python web / notebook frameworks."""

from __future__ import annotations

from typing import Any

from kgviz.figure import Graph3D


def streamlit_chart(fig: Graph3D, *, key: str | None = None) -> dict | None:
    from kgviz._streamlit import render_streamlit

    return render_streamlit(fig, key=key)


def gradio_html(fig: Graph3D, **kwargs: Any) -> str:
    """Return HTML suitable for ``gr.HTML(...)``."""
    return fig.to_html(**kwargs)


def dash_iframe(fig: Graph3D, **kwargs: Any):
    """Return a Dash ``html.Iframe`` for this figure."""
    from dash import html

    height = kwargs.pop("height", fig.to_dict().get("height") or 600)
    return html.Iframe(
        srcDoc=fig.to_html(full_html=True, include_js=True, **kwargs),
        style={"width": "100%", "height": f"{height}px", "border": "none"},
    )


def marimo_chart(fig: Graph3D, **kwargs: Any):
    """Return a marimo ``Html`` element for this figure."""
    import marimo as mo

    return mo.Html(fig.to_html(iframe=True, **kwargs))
