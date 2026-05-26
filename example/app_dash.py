"""kgviz Dash demo — run: python example/app_dash.py"""

from __future__ import annotations

import sys
from pathlib import Path

_EXAMPLE = Path(__file__).resolve().parent
if str(_EXAMPLE) not in sys.path:
    sys.path.insert(0, str(_EXAMPLE))

from dash import Dash, html
from demo_graph import make_figure
from kgviz.integrations import dash_iframe

fig = make_figure(height=600)

app = Dash(__name__)
app.title = "kgviz Dash demo"
app.layout = html.Div(
    style={"fontFamily": "system-ui", "maxWidth": "1200px", "margin": "0 auto"},
    children=[
        html.H1("kgviz — Dash"),
        html.P("3D knowledge graph via dash_iframe() → html.Iframe(srcDoc=...)."),
        dash_iframe(fig, height=600),
    ],
)


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=8050)
