"""kgviz Gradio demo — run: gradio example/app_gradio.py"""

from __future__ import annotations

import sys
from pathlib import Path

_EXAMPLE = Path(__file__).resolve().parent
if str(_EXAMPLE) not in sys.path:
    sys.path.insert(0, str(_EXAMPLE))

import gradio as gr
from demo_graph import make_figure
from kgviz.integrations import gradio_html


def build_demo() -> gr.Blocks:
    fig = make_figure()
    with gr.Blocks(title="kgviz Gradio demo") as demo:
        gr.Markdown(
            "# kgviz — Gradio\n"
            "3D knowledge graph via `gradio_html()` → `gr.HTML(...)`."
        )
        gr.HTML(gradio_html(fig))
    return demo


if __name__ == "__main__":
    build_demo().launch()
