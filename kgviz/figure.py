"""Graph3D figure — framework-agnostic API (Plotly/Altair-style)."""

from __future__ import annotations

import tempfile
import webbrowser
from pathlib import Path
from typing import Any

from kgviz._html import to_html as render_html
from kgviz._normalize import (
    apply_color_by,
    apply_color_by_edges,
    apply_fixed_coordinates,
    apply_size_by,
    apply_width_by,
    graph_from_networkx,
    normalize_edges,
    normalize_nodes,
)
from kgviz.layouts import LayoutMethod, build_map_graph, layout_method_label


def _in_streamlit() -> bool:
    try:
        from streamlit.runtime.scriptrunner import get_script_run_ctx

        return get_script_run_ctx() is not None
    except Exception:
        return False


def _in_ipython() -> bool:
    try:
        from IPython import get_ipython

        return get_ipython() is not None
    except Exception:
        return False


class Graph3D:
    """A 3D knowledge graph figure that works across notebooks and web frameworks."""

    @classmethod
    def from_map(
        cls,
        nodes: list[dict] | Any,
        features: Any,
        method: LayoutMethod = "pca",
        *,
        edges: list[dict] | Any | None = None,
        knn_k: int = 0,
        n_components: int = 3,
        node_color_by: str | None = "cluster",
        cluster_field: str = "cluster",
        **kwargs: Any,
    ) -> Graph3D:
        """
        Build a Cosmograph-style 2D embedding map from features (PCA, t-SNE, UMAP, or SOM).

        Requires: ``pip install 'kgviz[maps]'`` (numpy, scikit-learn; umap-learn / minisom per method).
        """
        node_list = normalize_nodes(nodes)
        node_list, knn_edges_list, _coords = build_map_graph(
            node_list,
            features,
            method=method,
            n_components=n_components,
            knn_k=knn_k,
            cluster_field=cluster_field if node_color_by else None,
        )
        edge_list = normalize_edges(edges) if edges is not None else normalize_edges(knn_edges_list)

        map_defaults: dict[str, Any] = {
            "use_coordinates": True,
            "default_view": "2d",
            "map_mode": True,
            "warmup_ticks": 0,
            "show_labels": False,
            "link_directional_arrow": False,
            "show_legend": True,
            "performance_mode": "auto",
        }
        if node_color_by:
            map_defaults["node_color_by"] = node_color_by
        if node_color_by == "cluster":
            map_defaults["legend_node_by"] = cluster_field
        map_defaults["show_nav_info"] = False
        map_defaults["layout_method"] = layout_method_label(method)
        map_defaults.update(kwargs)
        return cls(nodes=node_list, edges=edge_list, **map_defaults)

    @classmethod
    def kg_preset(
        cls,
        nodes: list[dict] | Any | None = None,
        edges: list[dict] | Any | None = None,
        graph: Any | None = None,
        **kwargs: Any,
    ) -> Graph3D:
        """Opinionated defaults for knowledge-graph exploration."""
        defaults: dict[str, Any] = {
            "link_directional_arrow": True,
            "show_legend": True,
            "focus_hops": 2,
            "enable_focus": True,
            "enable_multi_select": True,
            "search_keys": ["label", "id"],
            "performance_mode": "auto",
        }
        defaults.update(kwargs)
        return cls(nodes=nodes, edges=edges, graph=graph, **defaults)

    def __init__(
        self,
        nodes: list[dict] | Any | None = None,
        edges: list[dict] | Any | None = None,
        graph: Any | None = None,
        *,
        node_color: str = "color",
        node_color_by: str | None = None,
        node_size: str | float = "size",
        node_size_by: str | None = None,
        size_range: tuple[float, float] = (3, 14),
        node_label: str = "label",
        edge_color: str = "#ffffff",
        edge_color_by: str | None = None,
        edge_width: str | float = 1.5,
        edge_width_by: str | None = None,
        edge_width_range: tuple[float, float] = (0.5, 4.0),
        edge_label: str = "label",
        show_edge_labels: bool = False,
        legend_node_by: str | None = None,
        legend_edge_by: str | None = None,
        show_legend: bool = False,
        focus_hops: int = 2,
        enable_focus: bool = True,
        search_keys: list[str] | None = None,
        enable_multi_select: bool = True,
        map_mode: bool = False,
        layout_method: str | None = None,
        instanced_map_threshold: int = 1500,  # reserved; viewer uses canvas map overlay
        link_directional_arrow: bool = False,
        arrow_size: str = "medium",
        bidirectional: bool = False,
        use_coordinates: bool = False,
        dag_mode: str | None = None,
        warmup_ticks: int = 0,
        height: int | None = None,
        width: int | None = None,
        bg_color: str = "",
        show_nav_info: bool = False,
        show_labels: bool = False,
        label_outline: bool = False,
        grain_density: str = "medium",
        particle_flow: bool = False,
        particle_speed: float = 0.003,
        default_view: str = "3d",
        performance_mode: str = "auto",
    ) -> None:
        if graph is not None:
            node_list, edge_list = graph_from_networkx(graph)
        elif nodes is not None:
            node_list = normalize_nodes(nodes)
            edge_list = normalize_edges(edges or [])
        else:
            node_list = []
            edge_list = []

        if node_color_by:
            node_list = apply_color_by(node_list, node_color_by)
            node_color = "color"

        if node_size_by:
            node_list = apply_size_by(node_list, node_size_by, size_range)
            node_size = "size"

        if edge_color_by:
            edge_list = apply_color_by_edges(edge_list, edge_color_by)
            edge_color = "color"

        if edge_width_by:
            edge_list = apply_width_by(edge_list, edge_width_by, edge_width_range)
            edge_width = "width"

        if use_coordinates:
            node_list = apply_fixed_coordinates(node_list)

        self._graph_data = {"nodes": node_list, "edges": edge_list}
        self._config = {
            "graph_data": self._graph_data,
            "node_color": node_color,
            "node_size": node_size,
            "node_label": node_label,
            "edge_color": edge_color,
            "edge_width": edge_width,
            "edge_label": edge_label,
            "show_edge_labels": show_edge_labels,
            "legend_node_by": legend_node_by or node_color_by,
            "legend_edge_by": legend_edge_by or edge_color_by,
            "show_legend": show_legend,
            "focus_hops": max(0, int(focus_hops)),
            "enable_focus": enable_focus,
            "search_keys": search_keys if search_keys is not None else ["label", "id"],
            "enable_multi_select": enable_multi_select,
            "map_mode": map_mode,
            "layout_method": layout_method,
            "instanced_map_threshold": max(100, int(instanced_map_threshold)),
            "link_directional_arrow": link_directional_arrow,
            "arrow_size": arrow_size,
            "bidirectional": bidirectional,
            "use_coordinates": use_coordinates,
            "dag_mode": dag_mode,
            "warmup_ticks": warmup_ticks,
            "height": height,
            "width": width,
            "bg_color": bg_color,
            "show_nav_info": show_nav_info,
            "show_labels": show_labels,
            "label_outline": label_outline,
            "grain_density": grain_density,
            "particle_flow": particle_flow,
            "particle_speed": particle_speed,
            "default_view": default_view if default_view in ("2d", "3d") else "3d",
            "performance_mode": performance_mode
            if performance_mode in ("auto", "quality", "balanced", "performance")
            else "auto",
        }

    @property
    def graph_data(self) -> dict[str, list[dict]]:
        return self._graph_data

    def to_dict(self) -> dict[str, Any]:
        return dict(self._config)

    def to_html(
        self,
        *,
        full_html: bool = True,
        include_js: bool = True,
        js_url: str | None = None,
        height: int | None = None,
        width: int | None = None,
        iframe: bool = False,
    ) -> str:
        display_height = height or self._config.get("height") or 600
        display_width = width if width is not None else self._config.get("width")
        bg = self._config.get("bg_color") or "#0e1117"
        theme = {"backgroundColor": bg} if bg else {"backgroundColor": "#0e1117"}

        return render_html(
            {**self._config, "theme": theme},
            full_html=full_html,
            include_js=include_js,
            js_url=js_url,
            height=display_height,
            width=display_width,
            bg_color=theme["backgroundColor"],
            iframe=iframe,
        )

    def show(self, *, renderer: str = "auto") -> Graph3D:
        if renderer == "browser" or (renderer == "auto" and not _in_ipython()):
            with tempfile.NamedTemporaryFile(
                "w", suffix=".html", delete=False, encoding="utf-8"
            ) as handle:
                handle.write(self.to_html())
                path = Path(handle.name)
            webbrowser.open(path.as_uri())
            return self

        if _in_ipython():
            from IPython.display import display

            display(self)
            return self

        return self

    def _repr_html_(self) -> str:
        height = self._config.get("height") or 600
        return self.to_html(full_html=True, include_js=True, iframe=True, height=height)

    def _repr_mimebundle_(self, include=None, exclude=None):
        return {
            "text/html": self._repr_html_(),
            "text/plain": repr(self),
        }

    def __repr__(self) -> str:
        n_nodes = len(self._graph_data["nodes"])
        n_edges = len(self._graph_data["edges"])
        return f"Graph3D(nodes={n_nodes}, edges={n_edges})"


def kgviz(
    nodes: list[dict] | Any | None = None,
    edges: list[dict] | Any | None = None,
    graph: Any | None = None,
    *,
    key: str | None = None,
    **kwargs: Any,
) -> Graph3D | dict | None:
    """Create a 3D graph. Renders in Streamlit; returns a figure elsewhere."""
    fig = Graph3D(nodes=nodes, edges=edges, graph=graph, **kwargs)

    if _in_streamlit():
        from kgviz._streamlit import render_streamlit

        return render_streamlit(fig, key=key)

    return fig
