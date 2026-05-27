#!/usr/bin/env python3
"""Generate a t-SNE map demo from AI coding session transcripts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from kgviz import Graph3D
from kgviz.cortex_conversations import (
    DEFAULT_CORTEX_CONVERSATIONS,
    discover_cortex_history_files,
    load_cortex_sessions,
    load_cortex_turns,
)
from kgviz.jsonl_sessions import (
    DEFAULT_CLAUDE_PROJECTS,
    assign_lda_topics,
    discover_all_claude_transcripts,
    discover_all_cursor_transcripts,
    load_conversation_turns,
    load_jsonl_sessions,
    text_feature_matrix,
)

EXAMPLE_DIR = Path(__file__).resolve().parent
OUTPUT_HTML = EXAMPLE_DIR / "demo_map_sessions_tsne.html"
OUTPUT_HTML_LEGACY = EXAMPLE_DIR / "demo_map_cortex_tsne.html"


def load_nodes(
    source: str,
    *,
    per_session: bool,
    min_chars: int,
    cortex_dir: Path,
    cursor_dir: Path,
    claude_dir: Path,
) -> tuple[list[dict], dict]:
    nodes: list[dict] = []
    meta: dict = {"sources": {}}

    if source in ("cortex", "all"):
        paths = discover_cortex_history_files(cortex_dir)
        if not paths and source == "cortex":
            raise SystemExit(f"No *.history.jsonl under {cortex_dir}")
        if paths:
            if per_session:
                chunk = load_cortex_sessions(paths, conversations_root=cortex_dir, min_chars=min_chars)
            else:
                chunk = load_cortex_turns(paths, conversations_root=cortex_dir, min_chars=min_chars)
            for n in chunk:
                n.setdefault("source", "cortex")
            nodes.extend(chunk)
            meta["sources"]["cortex"] = {"files": len(paths), "points": len(chunk)}

    if source in ("cursor", "all"):
        paths = discover_all_cursor_transcripts(cursor_dir)
        if not paths and source == "cursor":
            raise SystemExit(f"No Cursor transcripts under {cursor_dir}")
        if paths:
            if per_session:
                chunk = load_jsonl_sessions(paths, min_chars=min_chars)
            else:
                chunk = load_conversation_turns(paths, min_chars=min_chars)
            nodes.extend(chunk)
            meta["sources"]["cursor"] = {"files": len(paths), "points": len(chunk)}

    if source in ("claude", "all"):
        paths = discover_all_claude_transcripts(claude_dir)
        if not paths and source == "claude":
            raise SystemExit(f"No Claude Code transcripts under {claude_dir}")
        if paths:
            if per_session:
                chunk = load_jsonl_sessions(paths, min_chars=min_chars)
            else:
                chunk = load_conversation_turns(paths, min_chars=min_chars)
            nodes.extend(chunk)
            meta["sources"]["claude"] = {"files": len(paths), "points": len(chunk)}

    return nodes, meta


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build embedding map from Cortex, Cursor, or Claude Code sessions",
    )
    parser.add_argument(
        "--source",
        choices=("cortex", "cursor", "claude", "all"),
        default="cortex",
        help="Session store (default: cortex)",
    )
    parser.add_argument(
        "--conversations-dir",
        "--cortex-dir",
        dest="cortex_dir",
        default=str(DEFAULT_CORTEX_CONVERSATIONS),
        help=f"Snowflake Cortex Code (default: {DEFAULT_CORTEX_CONVERSATIONS})",
    )
    parser.add_argument(
        "--cursor-dir",
        default=str(Path.home() / ".cursor" / "projects"),
        help="Cursor IDE projects root (agent-transcripts)",
    )
    parser.add_argument(
        "--claude-dir",
        default=str(DEFAULT_CLAUDE_PROJECTS),
        help=f"Claude Code CLI projects (default: {DEFAULT_CLAUDE_PROJECTS})",
    )
    parser.add_argument(
        "--per-session",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="One point per session, aggregated text (default: one point per message turn)",
    )
    parser.add_argument("--min-chars", type=int, default=24)
    parser.add_argument(
        "--color-by",
        choices=("topic", "role", "session", "workspace", "source", "project", "cluster"),
        default="topic",
    )
    parser.add_argument("--method", choices=("tsne", "pca", "umap"), default="tsne")
    parser.add_argument(
        "--max-points",
        type=int,
        default=0,
        help="Cap nodes for layout (0 = no cap). t-SNE slows above ~8k turns.",
    )
    parser.add_argument(
        "-o",
        "--output",
        default=str(OUTPUT_HTML),
        help=f"Output HTML path (default: {OUTPUT_HTML.name} in example/)",
    )
    parser.add_argument(
        "--topic-model",
        choices=("lda", "rules", "none"),
        default="lda",
        help="How to assign topic labels for --color-by topic (default: lda)",
    )
    parser.add_argument(
        "--n-topics",
        type=int,
        default=0,
        help="LDA topic count (0 = auto, typically 4–20)",
    )
    args = parser.parse_args()
    output_html = Path(args.output).expanduser().resolve()

    cortex_dir = Path(args.cortex_dir).expanduser().resolve()
    cursor_dir = Path(args.cursor_dir).expanduser().resolve()
    claude_dir = Path(args.claude_dir).expanduser().resolve()

    nodes, src_meta = load_nodes(
        args.source,
        per_session=args.per_session,
        min_chars=args.min_chars,
        cortex_dir=cortex_dir,
        cursor_dir=cursor_dir,
        claude_dir=claude_dir,
    )

    if not nodes:
        raise SystemExit("No conversation text found. Check --source and directory paths.")

    print(f"Source={args.source} → {len(nodes)} points")
    for name, info in src_meta.get("sources", {}).items():
        print(f"  {name}: {info['files']} files, {info['points']} points")

    if args.max_points and len(nodes) > args.max_points:
        step = max(1, len(nodes) // args.max_points)
        nodes = nodes[::step][: args.max_points]
        print(f"Subsampled to {len(nodes)} points (--max-points)")

    topic_labels: dict[int, str] = {}
    if args.topic_model == "lda":
        n_topics = args.n_topics if args.n_topics > 0 else None
        topic_labels = assign_lda_topics(nodes, n_topics=n_topics)
        print(f"LDA topics ({len(topic_labels)}):")
        for idx, label in sorted(topic_labels.items()):
            count = sum(1 for n in nodes if n.get("topic") == label)
            print(f"  [{idx}] {label} ({count} sessions)")
    elif args.topic_model == "none" and args.color_by == "topic":
        for n in nodes:
            n["topic"] = n.get("source", "unknown")

    method = args.method
    if method == "tsne" and len(nodes) > 8000:
        print(f"Note: {len(nodes)} points — t-SNE may take several minutes")

    features = text_feature_matrix([n["text"] for n in nodes])

    if args.color_by != "cluster":
        for n in nodes:
            n.pop("cluster", None)

    fig = Graph3D.from_map(
        nodes,
        features,
        method=method,  # type: ignore[arg-type]
        knn_k=0,
        node_color_by=args.color_by,
        legend_node_by=args.color_by,
        cluster_field="cluster" if args.color_by == "cluster" else None,
        height=720,
        show_nav_info=False,
    )
    html = fig.to_html()
    output_html.parent.mkdir(parents=True, exist_ok=True)
    output_html.write_text(html, encoding="utf-8")
    if output_html.resolve() != OUTPUT_HTML.resolve():
        OUTPUT_HTML.write_text(html, encoding="utf-8")
        OUTPUT_HTML_LEGACY.write_text(html, encoding="utf-8")

    meta = {
        "source": args.source,
        "cortex_dir": str(cortex_dir),
        "cursor_dir": str(cursor_dir),
        "claude_dir": str(claude_dir),
        "points": len(nodes),
        "per_session": args.per_session,
        "sessions": len({n.get("session_id", n["id"]) for n in nodes}),
        "method": method,
        "color_by": args.color_by,
        "topic_model": args.topic_model,
        "lda_topics": topic_labels,
        **src_meta,
    }
    meta_path = output_html.with_suffix(".meta.json")
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {output_html}")
    print(f"  {meta['points']} points · {method} · color by {args.color_by}")
    print("Open: python3 example/serve_demo.py → http://127.0.0.1:8765/demo_map_sessions_tsne.html")


if __name__ == "__main__":
    main()
