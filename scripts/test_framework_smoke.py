#!/usr/bin/env python3
"""Manual smoke test: print status for each framework integration."""

from __future__ import annotations

import importlib
import sys
import tempfile
from pathlib import Path

NODES = [
    {"id": "A", "label": "Alpha", "color": "#e74c3c"},
    {"id": "B", "label": "Beta", "color": "#2ecc71"},
    {"id": "C", "label": "Gamma", "color": "#3498db"},
]
EDGES = [{"source": "A", "target": "B"}, {"source": "B", "target": "C"}]


def ok(msg: str) -> None:
    print(f"  OK  {msg}")


def fail(msg: str) -> None:
    print(f"  FAIL {msg}", file=sys.stderr)


def main() -> int:
    from kgviz import Graph3D, kgviz
    from kgviz.integrations import gradio_html

    errors = 0
    fig = Graph3D(nodes=NODES, edges=EDGES, height=500, show_labels=True)

    print("Core HTML export")
    try:
        html = fig.to_html()
        assert "__KGVIZ_CONFIG__" in html and len(html) > 10_000
        ok(f"to_html() {len(html):,} bytes")
    except Exception as e:
        fail(f"to_html: {e}")
        errors += 1

    print("\nJupyter / IPython repr")
    try:
        mime = fig._repr_mimebundle_()
        assert "text/html" in mime
        ok("_repr_mimebundle_ has text/html")
    except Exception as e:
        fail(f"mimebundle: {e}")
        errors += 1

    print("\nGradio")
    try:
        h = gradio_html(fig)
        assert 'id="root"' in h
        ok("gradio_html()")
    except Exception as e:
        fail(f"gradio: {e}")
        errors += 1

    print("\nDash")
    try:
        dash = importlib.import_module("dash")
        from kgviz.integrations import dash_iframe

        iframe = dash_iframe(fig)
        assert iframe.srcDoc
        ok(f"dash_iframe ({type(iframe).__name__})")
    except ImportError:
        print("  SKIP dash not installed")
    except Exception as e:
        fail(f"dash: {e}")
        errors += 1

    print("\nMarimo")
    try:
        mo = importlib.import_module("marimo")
        from kgviz.integrations import marimo_chart

        el = marimo_chart(fig)
        assert isinstance(el, mo.Html)
        ok("marimo_chart()")
    except ImportError:
        print("  SKIP marimo not installed")
    except Exception as e:
        fail(f"marimo: {e}")
        errors += 1

    print("\nStreamlit (component declare)")
    try:
        st = importlib.import_module("streamlit")
        from kgviz._streamlit import _get_component_func

        fn = _get_component_func()
        ok(f"declare_component ({fn})")
    except ImportError:
        print("  SKIP streamlit not installed")
    except Exception as e:
        fail(f"streamlit declare: {e}")
        errors += 1

    print("\nMap mode (PCA)")
    try:
        import numpy as np

        nodes = [{"id": i, "label": f"Doc {i}"} for i in range(20)]
        X = np.random.default_rng(1).standard_normal((20, 6))
        mfig = Graph3D.from_map(nodes, X, method="pca")
        mfig.to_html()
        ok("Graph3D.from_map(pca)")
    except ImportError as e:
        print(f"  SKIP maps extra: {e}")
    except Exception as e:
        fail(f"from_map: {e}")
        errors += 1

    out = Path(tempfile.gettempdir()) / "kgviz_smoke_test.html"
    out.write_text(fig.to_html(), encoding="utf-8")
    print(f"\nWrote sample: {out}")
    print(f"\n{'PASSED' if errors == 0 else f'FAILED ({errors} errors)'}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
