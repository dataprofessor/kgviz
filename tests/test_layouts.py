import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("sklearn")

from kgviz.layouts import apply_layout_to_nodes, build_map_graph, compute_layout, knn_edges, scale_coords


def test_scale_coords():
    c = scale_coords([[0, 0], [1, 0], [0, 1]], target_span=100)
    assert float(np.max(np.abs(c[:, :2]))) == pytest.approx(100, rel=0.01)


def test_compute_pca_2d():
    rng = np.random.default_rng(0)
    X = rng.normal(size=(40, 8))
    coords = compute_layout(X, method="pca", n_components=2, target_span=50)
    assert coords.shape == (40, 3)


def test_build_map_graph_clusters():
    rng = np.random.default_rng(1)
    nodes = [{"id": i, "label": str(i)} for i in range(30)]
    X = rng.normal(size=(30, 5))
    out_nodes, edges, _ = build_map_graph(nodes, X, method="pca", knn_k=2, cluster_field="cluster")
    assert len(out_nodes) == 30
    assert "x" in out_nodes[0] and "y" in out_nodes[0]
    assert "cluster" in out_nodes[0]
    assert len(edges) >= 1


def test_knn_edges():
    nodes = [{"id": i} for i in range(5)]
    coords = [[i, 0] for i in range(5)]
    e = knn_edges(nodes, coords, k=2)
    assert len(e) >= 4
