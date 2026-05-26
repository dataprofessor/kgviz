from kgviz._normalize import apply_color_by_edges, apply_size_by, apply_width_by


def test_apply_size_by_numeric_range():
    nodes = [
        {"id": "a", "weight": 10},
        {"id": "b", "weight": 50},
        {"id": "c", "weight": 100},
    ]
    apply_size_by(nodes, "weight", (3, 13))
    assert nodes[0]["size"] == 3
    assert nodes[2]["size"] == 13
    assert abs(nodes[1]["size"] - 7.444444444444445) < 1e-9


def test_apply_size_by_ordinals():
    nodes = [
        {"id": "a", "tier": "small"},
        {"id": "b", "tier": "medium"},
        {"id": "c", "tier": "large"},
    ]
    apply_size_by(nodes, "tier", (4, 10))
    assert nodes[0]["size"] == 4
    assert nodes[2]["size"] == 10


def test_apply_size_by_constant_column():
    nodes = [{"id": "a", "n": 5}, {"id": "b", "n": 5}]
    apply_size_by(nodes, "n", (2, 8))
    assert nodes[0]["size"] == 5
    assert nodes[1]["size"] == 5


def test_apply_color_by_edges():
    edges = [
        {"source": "a", "target": "b", "relation": "CITES"},
        {"source": "b", "target": "c", "relation": "USES"},
    ]
    apply_color_by_edges(edges, "relation")
    assert edges[0]["color"].startswith("#")
    assert edges[0]["color"] != edges[1]["color"]


def test_apply_width_by_edges():
    edges = [
        {"source": "a", "target": "b", "weight": 1},
        {"source": "b", "target": "c", "weight": 10},
    ]
    apply_width_by(edges, "weight", (0.5, 3.5))
    assert edges[0]["width"] == 0.5
    assert edges[1]["width"] == 3.5
