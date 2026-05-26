"""HTML export for framework-agnostic embedding."""

from __future__ import annotations

import html
import json
from typing import Any

from kgviz._assets import read_bundle_js


def _json_script(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False).replace("<", "\\u003c")


def to_html(
    config: dict[str, Any],
    *,
    full_html: bool = True,
    include_js: bool = True,
    js_url: str | None = None,
    height: int = 600,
    width: int | None = None,
    bg_color: str = "#0e1117",
    iframe: bool = False,
) -> str:
    """Render a self-contained HTML fragment or document for the graph."""
    theme = config.get("theme") or {"backgroundColor": bg_color}
    payload = {**config, "theme": theme}
    if payload.get("height") is None:
        payload["height"] = height
    if width is not None:
        payload["width"] = width

    width_style = f"{width}px" if width is not None else "100%"
    root_height = "100vh" if full_html and not iframe else f"{height}px"
    if full_html and not iframe:
        payload["height"] = None

    config_script = (
        f"<script>window.__KGVIZ_CONFIG__ = {_json_script(payload)};</script>"
    )

    if include_js:
        bundle_js = read_bundle_js()
        module_script = f'<script type="module">\n{bundle_js}\n</script>'
    elif js_url:
        module_script = (
            f'<script type="module" src="{html.escape(js_url, quote=True)}"></script>'
        )
    else:
        raise ValueError("Either include_js=True or js_url must be provided.")

    body = f"""<div id="root" style="width:{width_style};height:{root_height};margin:0;padding:0;overflow:hidden;background:{html.escape(theme.get('backgroundColor', bg_color))};"></div>
{config_script}
{module_script}"""

    if not full_html:
        return body

    document = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>kgviz</title>
  <style>
    html, body {{ margin: 0; padding: 0; width: 100%; height: 100%; min-height: 100vh; overflow: hidden; background: {html.escape(theme.get('backgroundColor', bg_color))}; }}
    #root {{ min-height: 100vh; }}
  </style>
</head>
<body>
{body}
</body>
</html>"""

    if not iframe:
        return document

    escaped = html.escape(document, quote=True)
    return (
        f'<iframe srcdoc="{escaped}" width="100%" height="{height}" '
        f'frameborder="0" style="border:none;width:100%;height:{height}px;"></iframe>'
    )
