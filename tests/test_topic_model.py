"""Tests for LDA topic assignment on session text."""

from __future__ import annotations

from kgviz.jsonl_sessions import assign_lda_topics


def test_assign_lda_topics_labels_nodes() -> None:
    nodes = [
        {"text": "python pandas dataframe merge groupby plot"},
        {"text": "react typescript vite component hooks state"},
        {"text": "pandas numpy sklearn train test split model"},
        {"text": "react canvas webgl three.js animation render"},
        {"text": "docker kubernetes deploy helm chart cluster"},
        {"text": "sql snowflake warehouse cortex agent query"},
    ]
    topics = assign_lda_topics(nodes, n_topics=3)
    assert len(topics) == 3
    assert all(n.get("topic") for n in nodes)
    assert len({n["topic"] for n in nodes}) >= 2
