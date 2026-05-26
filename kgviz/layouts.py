"""Dimensionality reduction layouts for map-style KG visualization (PCA, t-SNE, SOM, UMAP)."""

from __future__ import annotations

from typing import Any, Literal

LayoutMethod = Literal["pca", "tsne", "umap", "som"]


def _require_numpy():
    try:
        import numpy as np
    except ImportError as e:
        raise ImportError(
            "Layout methods require numpy. Install with: pip install 'kgviz[maps]'"
        ) from e
    return np


def _require_sklearn():
    try:
        import sklearn  # noqa: F401
    except ImportError as e:
        raise ImportError(
            "PCA/t-SNE require scikit-learn. Install with: pip install 'kgviz[maps]'"
        ) from e


def _as_array(features: Any):
    np = _require_numpy()
    if hasattr(features, "values"):
        features = features.values
    arr = np.asarray(features, dtype=np.float64)
    if arr.ndim != 2:
        raise ValueError(f"features must be 2D (n_samples, n_features), got shape {arr.shape}")
    if arr.shape[0] == 0:
        raise ValueError("features must have at least one row")
    return arr


def scale_coords(coords: Any, target_span: float = 200.0) -> Any:
    """Center and scale coordinates so the layout fits the viewer."""
    np = _require_numpy()
    c = np.asarray(coords, dtype=np.float64)
    if c.ndim != 2 or c.shape[1] < 2:
        raise ValueError("coords must be (n_samples, 2+) ")
    out = c[:, :3].copy() if c.shape[1] >= 3 else np.column_stack([c[:, 0], c[:, 1], np.zeros(len(c))])
    xy = out[:, :2]
    center = xy.mean(axis=0)
    xy = xy - center
    extent = float(np.max(np.abs(xy))) or 1.0
    xy = xy * (target_span / extent)
    out[:, 0] = xy[:, 0]
    out[:, 1] = xy[:, 1]
    return out


def compute_layout(
    features: Any,
    method: LayoutMethod = "pca",
    n_components: int = 2,
    *,
    random_state: int = 42,
    target_span: float = 200.0,
    som_shape: tuple[int, int] = (24, 24),
    perplexity: float = 30.0,
    umap_neighbors: int = 15,
    umap_min_dist: float = 0.1,
) -> Any:
    """
    Run PCA, t-SNE, UMAP, or SOM on feature matrix (n_samples × n_features).

    Returns scaled coordinates (n_samples × 2 or 3).
    """
    X = _as_array(features)
    n = X.shape[0]
    n_components = max(2, min(n_components, 3, n - 1) if n > 1 else 2)

    if method == "pca":
        _require_sklearn()
        from sklearn.decomposition import PCA

        coords = PCA(n_components=n_components, random_state=random_state).fit_transform(X)
    elif method == "tsne":
        _require_sklearn()
        from sklearn.manifold import TSNE

        perp = min(perplexity, max(5.0, (n - 1) / 3))
        coords = TSNE(
            n_components=n_components,
            perplexity=perp,
            random_state=random_state,
            init="pca" if n > 50 else "random",
        ).fit_transform(X)
    elif method == "umap":
        try:
            import umap
        except ImportError as e:
            raise ImportError(
                "UMAP requires umap-learn. Install with: pip install 'kgviz[maps]'"
            ) from e
        reducer = umap.UMAP(
            n_components=n_components,
            n_neighbors=min(umap_neighbors, n - 1) if n > 1 else 1,
            min_dist=umap_min_dist,
            random_state=random_state,
        )
        coords = reducer.fit_transform(X)
    elif method == "som":
        np = _require_numpy()
        try:
            from minisom import MiniSom
        except ImportError as e:
            raise ImportError(
                "SOM requires minisom. Install with: pip install 'kgviz[maps]'"
            ) from e
        mx, my = som_shape
        mx = max(4, min(mx, max(4, int(n ** 0.5))))
        my = max(4, min(my, max(4, int(n ** 0.5))))
        som = MiniSom(mx, my, X.shape[1], sigma=1.2, learning_rate=0.5, random_seed=random_state)
        som.train(X, 200, verbose=False)
        winners = np.array([som.winner(v) for v in X])
        coords = np.column_stack([winners[:, 0], winners[:, 1]])
        if n_components >= 3:
            coords = np.column_stack([
                coords[:, 0],
                coords[:, 1],
                np.zeros(n),
            ])
    else:
        raise ValueError(f"Unknown layout method: {method!r}. Use pca, tsne, umap, or som.")

    return scale_coords(coords, target_span=target_span)


def apply_layout_to_nodes(
    nodes: list[dict],
    coords: Any,
    *,
    scale: float | None = None,
    z_value: float = 0.0,
) -> list[dict]:
    """Write x/y/z from layout coordinates onto node dicts."""
    np = _require_numpy()
    c = np.asarray(coords, dtype=np.float64)
    if scale is not None:
        c = scale_coords(c, target_span=scale)
    if len(nodes) != len(c):
        raise ValueError(f"nodes length ({len(nodes)}) != coords rows ({len(c)})")
    for node, row in zip(nodes, c):
        node["x"] = float(row[0])
        node["y"] = float(row[1])
        node["z"] = float(row[2]) if c.shape[1] >= 3 else z_value
    return nodes


def knn_edges(
    nodes: list[dict],
    coords: Any,
    k: int = 3,
    *,
    max_edges: int | None = None,
) -> list[dict]:
    """Build undirected k-nearest-neighbour edges from layout positions."""
    if k <= 0 or len(nodes) < 2:
        return []
    _require_sklearn()
    from sklearn.neighbors import NearestNeighbors

    np = _require_numpy()
    X = np.asarray(coords, dtype=np.float64)[:, :2]
    nn = NearestNeighbors(n_neighbors=min(k + 1, len(nodes))).fit(X)
    _, indices = nn.kneighbors(X)

    seen: set[tuple[str | int, str | int]] = set()
    edges: list[dict] = []
    for i, nbrs in enumerate(indices):
        a = nodes[i]["id"]
        for j in nbrs[1:]:
            b = nodes[j]["id"]
            key = (a, b) if a < b else (b, a)
            if key in seen:
                continue
            seen.add(key)
            edges.append({"source": a, "target": b, "weight": 1})
            if max_edges and len(edges) >= max_edges:
                return edges
    return edges


def build_map_graph(
    nodes: list[dict],
    features: Any,
    method: LayoutMethod = "pca",
    *,
    n_components: int = 2,
    knn_k: int = 0,
    cluster_field: str | None = "cluster",
    random_state: int = 42,
    **layout_kwargs: Any,
) -> tuple[list[dict], list[dict], Any]:
    """
    Compute layout, attach coordinates to nodes, optionally add KNN edges.

    If ``cluster_field`` is set and sklearn is available, runs k-means (≤20 clusters)
    and stores integer cluster ids on each node for coloring.
    """
    import copy

    node_list = copy.deepcopy(nodes)
    coords = compute_layout(
        features,
        method=method,
        n_components=n_components,
        random_state=random_state,
        **layout_kwargs,
    )
    apply_layout_to_nodes(node_list, coords)

    if cluster_field:
        _assign_clusters(node_list, _as_array(features), cluster_field, random_state)

    edge_list = knn_edges(node_list, coords, k=knn_k) if knn_k > 0 else []
    return node_list, edge_list, coords


def _assign_clusters(
    nodes: list[dict],
    features: Any,
    field: str,
    random_state: int,
) -> None:
    n = len(nodes)
    if n < 2:
        if nodes:
            nodes[0][field] = 0
        return
    _require_sklearn()
    from sklearn.cluster import KMeans

    k = min(20, max(2, int(n**0.5)))
    labels = KMeans(n_clusters=k, random_state=random_state, n_init=10).fit_predict(features)
    for node, lab in zip(nodes, labels):
        node[field] = int(lab)


def layout_method_label(method: LayoutMethod) -> str:
    return {"pca": "PCA", "tsne": "t-SNE", "umap": "UMAP", "som": "SOM"}[method]
