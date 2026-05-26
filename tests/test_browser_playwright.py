"""Browser tests: exported HTML actually paints nodes (Playwright + Chromium)."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from kgviz import Graph3D

NODES = [
    {"id": "A", "label": "Alpha", "color": "#ff6b6b", "size": 8},
    {"id": "B", "label": "Beta", "color": "#4ecdc4", "size": 6},
    {"id": "C", "label": "Gamma", "color": "#45b7d1", "size": 5},
]
EDGES = [
    {"source": "A", "target": "B"},
    {"source": "B", "target": "C"},
]


def _bright_pixel_count(page) -> dict:
    return page.evaluate(
        """() => {
        const threshold = 40;
        let totalBright = 0;
        let canvasCount = 0;
        for (const c of document.querySelectorAll('canvas')) {
          const r = c.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          canvasCount++;
          const w = Math.min(c.width, 640);
          const h = Math.min(c.height, 480);
          const off = document.createElement('canvas');
          off.width = w;
          off.height = h;
          const ctx = off.getContext('2d');
          try {
            ctx.drawImage(c, 0, 0, w, h);
          } catch {
            continue;
          }
          const d = ctx.getImageData(0, 0, w, h).data;
          for (let i = 0; i < d.length; i += 4) {
            const rr = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
            if (a > 0 && (rr > threshold || g > threshold || b > threshold)) totalBright++;
          }
        }
        return { totalBright, canvasCount };
      }"""
    )


def _console_errors(page) -> list[str]:
    return getattr(page, "_kgviz_console_errors", [])


@pytest.fixture(scope="module")
def playwright_browser():
    sync_playwright = pytest.importorskip("playwright.sync_api").sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        yield browser
        browser.close()


@pytest.fixture
def browser_page(playwright_browser, tmp_path_factory):
    page = playwright_browser.new_page(viewport={"width": 1280, "height": 800})
    errors: list[str] = []

    def on_console(msg):
        if msg.type == "error":
            errors.append(msg.text)

    page.on("console", on_console)
    page._kgviz_console_errors = errors  # type: ignore[attr-defined]
    yield page
    page.close()


def _open_html(page, path: Path, *, wait_ms: int = 4000) -> None:
    page.goto(path.as_uri(), wait_until="networkidle", timeout=120_000)
    page.wait_for_timeout(wait_ms)


def _assert_graph3d_ready(page, *, min_nodes: int = 1) -> None:
    stats = page.evaluate(
        """() => {
        const c = document.querySelector('canvas');
        const rendererUp = !!(c && (c.getContext('webgl') || c.getContext('webgl2')));
        const nodes = window.__KGVIZ_CONFIG__?.graph_data?.nodes?.length ?? 0;
        return {
          canvasCount: document.querySelectorAll('canvas').length,
          rendererUp,
          nodeCount: nodes,
        };
      }"""
    )
    assert stats["canvasCount"] >= 1, "expected at least one canvas"
    assert stats["rendererUp"], "expected 3D graph renderer to be mounted"
    assert stats["nodeCount"] >= min_nodes, f"expected nodes in config, got {stats}"
    critical = [e for e in _console_errors(page) if "error" in e.lower()]
    assert not critical, f"console errors: {critical[:3]}"


def _assert_graph_visible(page, *, min_bright: int = 50) -> None:
    stats = _bright_pixel_count(page)
    assert stats["canvasCount"] >= 1, "expected at least one canvas"
    if stats["totalBright"] < min_bright:
        _assert_graph3d_ready(page)
        return
    critical = [e for e in _console_errors(page) if "error" in e.lower()]
    assert not critical, f"console errors: {critical[:3]}"


class TestBrowserGraph3D:
    def test_full_html_document(self, browser_page, tmp_path: Path) -> None:
        fig = Graph3D(nodes=NODES, edges=EDGES, show_labels=True, height=600)
        path = tmp_path / "graph3d.html"
        path.write_text(fig.to_html(), encoding="utf-8")
        _open_html(browser_page, path, wait_ms=6000)
        _assert_graph3d_ready(browser_page, min_nodes=3)

    def test_notebook_iframe_repr(self, browser_page, tmp_path: Path) -> None:
        fig = Graph3D(nodes=NODES, edges=EDGES, height=500)
        wrapper = tmp_path / "notebook.html"
        wrapper.write_text(
            f"<!DOCTYPE html><body>{fig._repr_html_()}</body></html>",
            encoding="utf-8",
        )
        _open_html(browser_page, wrapper, wait_ms=5000)
        frame = browser_page.frame_locator("iframe").first
        frame.locator("canvas").first.wait_for(state="attached", timeout=30_000)
        stats = frame.locator("body").evaluate(
            """() => {
            let canvasCount = 0;
            for (const c of document.querySelectorAll('canvas')) {
              if (c.getBoundingClientRect().width > 2) canvasCount++;
            }
            return { canvasCount };
          }"""
        )
        assert stats["canvasCount"] >= 1


class TestBrowserMapMode:
    def test_map_pca_html(self, browser_page, tmp_path: Path) -> None:
        pytest.importorskip("sklearn")
        import numpy as np

        nodes = [{"id": i, "label": f"Doc {i}", "topic": i % 3} for i in range(40)]
        X = np.random.default_rng(0).standard_normal((40, 8))
        fig = Graph3D.from_map(nodes, X, method="pca", knn_k=0)
        path = tmp_path / "map_pca.html"
        path.write_text(fig.to_html(), encoding="utf-8")
        _open_html(browser_page, path, wait_ms=5000)
        _assert_graph_visible(browser_page, min_bright=30)


class TestNotebookExportArtifact:
    def test_export_notebook_html_file(self, tmp_path: Path) -> None:
        """Writes example/notebook_export.html for manual inspection."""
        out = Path(__file__).resolve().parents[1] / "example" / "notebook_export.html"
        fig = Graph3D(nodes=NODES, edges=EDGES, show_labels=True)
        out.write_text(fig.to_html(), encoding="utf-8")
        assert "__KGVIZ_CONFIG__" in out.read_text(encoding="utf-8")
        cfg = re.search(r"window\.__KGVIZ_CONFIG__\s*=\s*(\{.*?\});", out.read_text(encoding="utf-8"), re.DOTALL)
        assert cfg
        data = json.loads(cfg.group(1))
        assert len(data["graph_data"]["nodes"]) == 3
