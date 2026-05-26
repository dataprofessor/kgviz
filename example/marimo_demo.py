"""kgviz marimo demo — run: marimo edit example/marimo_demo.py"""

from __future__ import annotations

import sys
from pathlib import Path

import marimo

__generated_with = "0.11.0"
app = marimo.App(width="medium")

_EXAMPLE = Path(__file__).resolve().parent
if str(_EXAMPLE) not in sys.path:
    sys.path.insert(0, str(_EXAMPLE))


@app.cell
def _():
    import marimo as mo

    from demo_graph import make_figure
    from kgviz.integrations import marimo_chart

    return make_figure, marimo_chart, mo


@app.cell
def _(mo):
    mo.md(
        """
        # kgviz — marimo

        Interactive 3D knowledge graph via `marimo_chart()` → `mo.Html(...)`.
        """
    )
    return


@app.cell
def _(make_figure):
    fig = make_figure()
    return (fig,)


@app.cell
def _(fig, marimo_chart):
    marimo_chart(fig)
    return


if __name__ == "__main__":
    app.run()
