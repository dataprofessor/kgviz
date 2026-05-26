"""Integration tests: notebooks (IPython repr) and web framework helpers."""

from __future__ import annotations

import html as html_lib
import json
import re

import pytest

from kgviz import Graph3D, kgviz
from kgviz.integrations import dash_iframe, gradio_html

NODES = [
    {"id": "A", "label": "Alpha", "color": "#ff6b6b", "size": 6},
    {"id": "B", "label": "Beta", "color": "#4ecdc4", "size": 5},
    {"id": "C", "label": "Gamma", "color": "#45b7d1", "size": 4},
]
EDGES = [
    {"source": "A", "target": "B"},
    {"source": "B", "target": "C"},
]


def _sample_fig(**kwargs) -> Graph3D:
    return Graph3D(nodes=NODES, edges=EDGES, show_labels=True, height=480, **kwargs)


def _unwrap_iframe(html: str) -> str:
    if 'srcdoc="' not in html:
        return html
    match = re.search(r'srcdoc="([^"]*)"', html, re.DOTALL)
    assert match, "iframe without srcdoc"
    return html_lib.unescape(match.group(1))


def _parse_config(html: str) -> dict:
    inner = _unwrap_iframe(html)
    match = re.search(r"window\.__KGVIZ_CONFIG__\s*=\s*(\{.*?\});", inner, re.DOTALL)
    assert match, "missing __KGVIZ_CONFIG__ in HTML"
    return json.loads(match.group(1))


def _assert_embedded_viewer(html: str) -> None:
    assert "__KGVIZ_CONFIG__" in html or "&quot;graph_data&quot;" in html
    assert "root" in html


@pytest.fixture
def fig() -> Graph3D:
    return _sample_fig()


class TestHtmlExport:
    def test_to_html_full_document(self, fig: Graph3D) -> None:
        html = fig.to_html(full_html=True, include_js=True)
        assert "<!DOCTYPE html>" in html or "<html" in html.lower()
        assert 'id="root"' in html
        assert "type=\"module\"" in html
        cfg = _parse_config(html)
        assert len(cfg["graph_data"]["nodes"]) == 3
        assert len(cfg["graph_data"]["edges"]) == 2
        assert cfg.get("height") in (480, None)

    def test_to_html_fragment(self, fig: Graph3D) -> None:
        html = fig.to_html(full_html=False, include_js=True)
        assert "<!DOCTYPE" not in html
        assert 'id="root"' in html
        _parse_config(html)

    def test_to_html_iframe_mode(self, fig: Graph3D) -> None:
        html = fig.to_html(iframe=True, height=400)
        assert "<iframe" in html and "400px" in html
        _assert_embedded_viewer(html)
        _parse_config(html)

    def test_to_dict_roundtrip_keys(self, fig: Graph3D) -> None:
        d = fig.to_dict()
        for key in ("graph_data", "show_labels", "default_view", "height"):
            assert key in d
        assert d["graph_data"]["nodes"][0]["id"] == "A"


class TestNotebookRepr:
    def test_repr_html_for_jupyter(self, fig: Graph3D) -> None:
        html = fig._repr_html_()
        assert isinstance(html, str) and len(html) > 500
        assert "<iframe" in html
        _assert_embedded_viewer(html)
        cfg = _parse_config(html)
        assert cfg["graph_data"]["nodes"]

    def test_repr_mimebundle(self, fig: Graph3D) -> None:
        bundle = fig._repr_mimebundle_()
        assert "text/html" in bundle
        assert "text/plain" in bundle
        assert "Graph3D" in bundle["text/plain"]
        _parse_config(bundle["text/html"])


class TestGradio:
    def test_gradio_html_returns_self_contained_document(self, fig: Graph3D) -> None:
        html = gradio_html(fig)
        assert "<!DOCTYPE html>" in html
        assert 'id="root"' in html
        _parse_config(html)


class TestDash:
    def test_dash_iframe(self, fig: Graph3D) -> None:
        pytest.importorskip("dash")
        from dash import html

        component = dash_iframe(fig, height=520)
        assert isinstance(component, html.Iframe)
        assert component.srcDoc
        assert "520px" in component.style["height"]
        _parse_config(component.srcDoc)


class TestMarimo:
    def test_marimo_chart(self, fig: Graph3D) -> None:
        mo = pytest.importorskip("marimo")
        out = __import__("kgviz.integrations", fromlist=["marimo_chart"]).marimo_chart(fig)
        assert isinstance(out, mo.Html)
        html = out.text
        assert "<iframe" in html
        _parse_config(html)


class TestStreamlit:
    def test_kgviz_returns_figure_outside_streamlit(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("kgviz.figure._in_streamlit", lambda: False)
        result = kgviz(nodes=NODES, edges=EDGES)
        assert isinstance(result, Graph3D)

    def test_streamlit_render_invokes_component(self, fig: Graph3D, monkeypatch: pytest.MonkeyPatch) -> None:
        calls: list[dict] = []

        def fake_component(**kwargs):
            calls.append(kwargs)
            return {"node_ids": ["A"], "focus_id": None}

        monkeypatch.setattr(
            "kgviz._streamlit._get_component_func",
            lambda: fake_component,
        )
        from kgviz.integrations import streamlit_chart

        out = streamlit_chart(fig, key="test-graph")
        assert out == {"node_ids": ["A"], "focus_id": None}
        assert len(calls) == 1
        assert calls[0]["graph_data"]["nodes"]
        assert calls[0].get("key") == "test-graph" or "key" in calls[0]

    def test_kgviz_renders_inside_streamlit(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("kgviz.figure._in_streamlit", lambda: True)
        monkeypatch.setattr(
            "kgviz._streamlit.render_streamlit",
            lambda f, key=None: {"ok": True},
        )
        result = kgviz(nodes=NODES, edges=EDGES, key="k1")
        assert result == {"ok": True}


class TestMapMode:
    def test_from_map_pca(self) -> None:
        pytest.importorskip("sklearn")
        import numpy as np

        nodes = [{"id": i, "label": f"n{i}", "topic": i % 2} for i in range(12)]
        features = np.random.default_rng(0).standard_normal((12, 8))
        fig = Graph3D.from_map(nodes, features, method="pca", knn_k=0)
        html = fig.to_html(iframe=True)
        cfg = _parse_config(html)
        assert cfg.get("map_mode") is True
        assert cfg.get("use_coordinates") is True
        for n in cfg["graph_data"]["nodes"]:
            assert "x" in n and "y" in n


class TestKgPreset:
    def test_kg_preset_html(self) -> None:
        fig = Graph3D.kg_preset(
            nodes=NODES,
            edges=EDGES,
            node_color_by="id",
            show_legend=True,
        )
        html = fig.to_html()
        cfg = _parse_config(html)
        assert cfg.get("show_legend") is True
        assert all("color" in n for n in cfg["graph_data"]["nodes"])
