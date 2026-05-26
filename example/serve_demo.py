#!/usr/bin/env python3
"""Serve the standalone HTML demo from example/."""
from __future__ import annotations

import argparse
import http.server
import os
import socketserver
import sys
from pathlib import Path

EXAMPLE_DIR = Path(__file__).resolve().parent


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve kgviz standalone demo")
    parser.add_argument("--port", "-p", type=int, default=8765, help="Port (default: 8765)")
    args = parser.parse_args()

    demo = EXAMPLE_DIR / "demo.html"
    if not demo.is_file():
        print(f"Missing {demo}", file=sys.stderr)
        print("Regenerate with: python -c \"from kgviz import Graph3D; ...\"", file=sys.stderr)
        return 1

    os.chdir(EXAMPLE_DIR)
    handler = http.server.SimpleHTTPRequestHandler

    class QuietHandler(handler):
        def end_headers(self) -> None:
            if self.path.endswith(".html"):
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            super().end_headers()

        def log_message(self, fmt: str, *log_args: object) -> None:
            if log_args and str(log_args[1]).startswith("4"):
                super().log_message(fmt, *log_args)

    try:
        with socketserver.TCPServer(("", args.port), QuietHandler) as httpd:
            print(f"Serving: {EXAMPLE_DIR}")
            print(f"Open:    http://127.0.0.1:{args.port}/")
            print(f"  Small:  http://127.0.0.1:{args.port}/demo.html")
            if (EXAMPLE_DIR / "demo_100.html").is_file():
                print(f"  100n:   http://127.0.0.1:{args.port}/demo_100.html")
            if (EXAMPLE_DIR / "demo_1000.html").is_file():
                print(f"  1000n:  http://127.0.0.1:{args.port}/demo_1000.html")
            if (EXAMPLE_DIR / "demo_map_tsne.html").is_file():
                print(f"  t-SNE:  http://127.0.0.1:{args.port}/demo_map_tsne.html")
            if (EXAMPLE_DIR / "demo_map_sessions_tsne.html").is_file():
                print(f"  Cortex:   http://127.0.0.1:{args.port}/demo_map_sessions_tsne.html")
            if (EXAMPLE_DIR / "demo_map_cortex_tsne.html").is_file():
                print(f"  Cortex:   http://127.0.0.1:{args.port}/demo_map_cortex_tsne.html")
            if (EXAMPLE_DIR / "demo_map_50k.html").is_file():
                print(f"  50k:    http://127.0.0.1:{args.port}/demo_map_50k.html")
            httpd.serve_forever()
    except OSError as e:
        if e.errno == 48 or "Address already in use" in str(e):
            print(f"Port {args.port} is in use. Stop the other server or run:", file=sys.stderr)
            print(f"  python3 example/serve_demo.py --port {args.port + 1}", file=sys.stderr)
        else:
            print(e, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
