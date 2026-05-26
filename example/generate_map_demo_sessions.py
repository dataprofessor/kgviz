#!/usr/bin/env python3
"""Generate a t-SNE map demo from Snowflake Cortex conversation history."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from kgviz import Graph3D
from kgviz.cortex_conversations import (
    DEFAULT_CORTEX_CONVERSATIONS,
    discover_cortex_history_files,
    load_cortex_from_dir,
    load_cortex_sessions,
    load_cortex_turns,
)
from kgviz.jsonl_sessions import text_feature_matrix

EXAMPLE_DIR = Path(__file__).resolve().parent
OUTPUT_HTML = EXAMPLE_DIR / "demo_map_sessions_tsne.html"
OUTPUT_HTML_LEGACY = EXAMPLE_DIR / "demo_map_cortex_tsne.html"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build t-SNE map from ~/.snowflake/cortex/conversations",
    )
    parser.add_argument(
        "--conversations-dir",
        default=str(DEFAULT_CORTEX_CONVERSATIONS),
        help=f"Cortex conversations root (default: {DEFAULT_CORTEX_CONVERSATIONS})",
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
        choices=("topic", "role", "session", "workspace", "cluster"),
        default="topic",
    )
    parser.add_argument("--method", choices=("tsne", "pca", "umap"), default="tsne")
    parser.add_argument(
        "--max-points",
        type=int,
        default=0,
        help="Cap nodes for layout (0 = no cap). t-SNE slows above ~8k turns.",
    )
    args = parser.parse_args()

    root = Path(args.conversations_dir).expanduser().resolve()
    paths = discover_cortex_history_files(root)
    if not paths:
        raise SystemExit(f"No *.history.jsonl under {root}")

    print(f"Cortex conversations: {len(paths)} sessions under {root}")

    if args.per_session:
        nodes = load_cortex_sessions(paths, conversations_root=root, min_chars=args.min_chars)
    else:
        nodes = load_cortex_turns(paths, conversations_root=root, min_chars=args.min_chars)

    if not nodes:
        raise SystemExit(f"No nodes with ≥{args.min_chars} chars")

    if args.max_points and len(nodes) > args.max_points:
        step = max(1, len(nodes) // args.max_points)
        nodes = nodes[::step][: args.max_points]
        print(f"Subsampled to {len(nodes)} points (--max-points)")

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
        height=720,
        show_nav_info=False,
    )
    html = fig.to_html()
    OUTPUT_HTML.write_text(html, encoding="utf-8")
    OUTPUT_HTML_LEGACY.write_text(html, encoding="utf-8")

    meta = {
        "source": str(root),
        "history_files": len(paths),
        "points": len(nodes),
        "per_session": args.per_session,
        "sessions": len({n["session_id"] for n in nodes}),
        "workspaces": len({n.get("workspace", "default") for n in nodes}),
        "method": method,
        "color_by": args.color_by,
    }
    meta_path = EXAMPLE_DIR / "demo_map_sessions_tsne.meta.json"
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {OUTPUT_HTML}")
    print(
        f"  {meta['points']} points · {meta['history_files']} sessions · "
        f"{meta['workspaces']} workspaces · {method}"
    )
    print("Open: python3 serve_demo.py → http://127.0.0.1:8765/demo_map_sessions_tsne.html")


if __name__ == "__main__":
    main()
