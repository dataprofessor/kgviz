"""Locate bundled viewer assets."""

from __future__ import annotations

from pathlib import Path

_PACKAGE_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _PACKAGE_DIR.parent


def build_dir_candidates() -> list[Path]:
    """Return possible viewer build directories, in search order."""
    return [
        _REPO_ROOT / "viewer" / "build",
        _PACKAGE_DIR / "_viewer" / "build",
    ]


def get_build_dir() -> Path:
    for build_dir in build_dir_candidates():
        if (build_dir / "index.html").is_file():
            return build_dir

    raise FileNotFoundError(
        "Viewer build not found. Build it with:\n"
        "  cd viewer && npm install && npm run build"
    )


def get_bundle_path() -> Path:
    assets_dir = get_build_dir() / "assets"
    fixed = assets_dir / "kgviz.js"
    if fixed.is_file():
        return fixed

    if assets_dir.is_dir():
        candidates = sorted(
            assets_dir.glob("*.js"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        if candidates:
            return candidates[0]

    raise FileNotFoundError(
        "Viewer JS bundle not found. Build it with:\n"
        "  cd viewer && npm install && npm run build"
    )


def read_bundle_js() -> str:
    return get_bundle_path().read_text(encoding="utf-8")
