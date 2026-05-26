"""Load Cursor-style agent transcript JSONL files for embedding maps."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterable

_USER_QUERY_RE = re.compile(r"<user_query>\s*(.*?)\s*</user_query>", re.DOTALL | re.IGNORECASE)

_TOPIC_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("Map / 3D view", ("3d mode", "2d mode", "orbit", "pan", "zoom", "map_mode", "overlay", "projection")),
    ("Labels & UI", ("show labels", "label", "toolbar", "widget", "button", "top-left", "right menu")),
    ("Interaction", ("hover", "select", "click", "opacity", "node")),
    ("Demo / server", ("demo server", "serve_demo", "browser", "playwright", "8765")),
    ("Clustering", ("cluster", "pca", "tsne", "t-sne", "embedding")),
    ("Build / dev", ("npm run build", "generate_map", "bundle", "viewer")),
]


def _require_sklearn():
    try:
        import sklearn  # noqa: F401
    except ImportError as e:
        raise ImportError(
            "Text features require scikit-learn. Install with: pip install 'kgviz[maps]'"
        ) from e


def message_role(record: dict[str, Any]) -> str:
    """User/assistant role from Cursor or Claude Code JSONL records."""
    role = str(record.get("role") or record.get("type") or "").lower()
    if role in ("user", "assistant"):
        return role
    message = record.get("message")
    if isinstance(message, dict):
        inner = str(message.get("role", "")).lower()
        if inner in ("user", "assistant"):
            return inner
    return ""


def extract_message_text(record: dict[str, Any]) -> str:
    """Pull plain text from a JSONL message record (Cursor IDE or Claude Code)."""
    message = record.get("message")
    if isinstance(message, str):
        return message.strip()
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        if item.get("type") != "text":
            continue
        text = item.get("text")
        if isinstance(text, str) and text.strip():
            parts.append(text.strip())
    return "\n".join(parts).strip()


def extract_user_query(text: str) -> str | None:
    match = _USER_QUERY_RE.search(text)
    if match:
        return re.sub(r"\s+", " ", match.group(1)).strip()
    return None


def infer_topic(text: str) -> str:
    lower = text.lower()
    for topic, keywords in _TOPIC_RULES:
        if any(k in lower for k in keywords):
            return topic
    if "kgviz" in lower or "forcegraph" in lower:
        return "kgviz"
    return "General"


def truncate_label(text: str, max_len: int = 72) -> str:
    one_line = re.sub(r"\s+", " ", text).strip()
    if len(one_line) <= max_len:
        return one_line
    return one_line[: max_len - 1] + "…"


def session_title_from_path(path: Path, *, session_id: str | None = None) -> str:
    sid = session_id or path.stem
    if len(sid) > 12:
        return f"session {sid[:8]}…"
    return f"session {sid}"


def infer_project_and_session(path: Path) -> tuple[str, str]:
    """Return (project_slug, session_id) from a transcript file path."""
    resolved = path.expanduser().resolve()
    parts = resolved.parts
    if "agent-transcripts" in parts:
        idx = parts.index("agent-transcripts")
        project = parts[idx - 1] if idx > 0 else "unknown"
    elif "projects" in parts and ".claude" in parts:
        idx = parts.index("projects")
        project = parts[idx + 1] if idx + 1 < len(parts) else "unknown"
    elif "sessions" in parts:
        project = "bundled"
    else:
        project = resolved.parent.parent.name

    parent_name = resolved.parent.name
    if parent_name in ("agent-transcripts", "sessions", "data"):
        session_id = resolved.stem
    else:
        session_id = parent_name
    return project, session_id


DEFAULT_CLAUDE_PROJECTS = Path.home() / ".claude" / "projects"


def discover_all_claude_transcripts(
    projects_root: Path | str | None = None,
) -> list[Path]:
    """Collect session JSONL files from ``~/.claude/projects/<project>/*.jsonl`` (Claude Code CLI)."""
    root = Path(projects_root or DEFAULT_CLAUDE_PROJECTS).expanduser()
    if not root.is_dir():
        return []
    files: list[Path] = []
    for project_dir in sorted(root.iterdir()):
        if not project_dir.is_dir():
            continue
        for path in sorted(project_dir.glob("*.jsonl")):
            if path.is_file():
                files.append(path)
    return files


def discover_all_cursor_transcripts(
    projects_root: Path | str | None = None,
    *,
    include_subagents: bool = False,
) -> list[Path]:
    """Collect session JSONL files from every ``~/.cursor/projects/*/agent-transcripts`` tree."""
    root = Path(projects_root or Path.home() / ".cursor" / "projects").expanduser()
    if not root.is_dir():
        return []
    files: list[Path] = []
    for project_dir in sorted(root.iterdir()):
        if not project_dir.is_dir():
            continue
        transcripts = project_dir / "agent-transcripts"
        if not transcripts.is_dir():
            continue
        files.extend(discover_jsonl_files(transcripts, include_subagents=include_subagents))
    return files


def iter_jsonl_records(path: Path) -> Iterable[tuple[int, dict[str, Any]]]:
    with path.open(encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(record, dict):
                yield line_no, record


def discover_jsonl_files(
    root: Path | str,
    *,
    include_subagents: bool = False,
) -> list[Path]:
    root = Path(root).expanduser().resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"JSONL directory not found: {root}")
    files = sorted(root.rglob("*.jsonl") if root.is_dir() else [])
    if not include_subagents:
        files = [p for p in files if "subagents" not in p.parts]
    return files


def load_conversation_turns(
    jsonl_paths: Iterable[Path | str],
    *,
    min_chars: int = 24,
    include_roles: frozenset[str] | None = None,
) -> list[dict[str, Any]]:
    """
    Load JSONL transcript files into turn dicts for map visualization.

    Each turn becomes one node with fields: id, label, role, session, topic, text, line.
    """
    roles = include_roles or frozenset({"user", "assistant"})
    turns: list[dict[str, Any]] = []

    for raw_path in jsonl_paths:
        path = Path(raw_path).expanduser().resolve()
        if not path.is_file():
            continue
        project, session_id = infer_project_and_session(path)
        session_label = session_title_from_path(path, session_id=session_id)

        for line_no, record in iter_jsonl_records(path):
            role = message_role(record)
            if role not in roles:
                continue
            text = extract_message_text(record)
            if len(text) < min_chars:
                continue
            query = extract_user_query(text) if role == "user" else None
            display = query or text
            topic = infer_topic(display)
            turn_id = f"{project}:{session_id}:{line_no}"
            source = "claude" if ".claude" in path.parts else "cursor"
            turns.append({
                "id": turn_id,
                "label": truncate_label(display),
                "role": role.capitalize(),
                "session": session_label,
                "session_id": session_id,
                "project": project,
                "source": source,
                "topic": topic,
                "text": text,
                "line": line_no,
                "source_file": path.name,
            })
    return turns


def text_feature_matrix(texts: list[str], *, max_features: int = 256) -> Any:
    """TF–IDF feature matrix for layout methods (n_samples × n_features)."""
    _require_sklearn()
    from sklearn.feature_extraction.text import TfidfVectorizer

    vectorizer = TfidfVectorizer(
        max_features=max_features,
        stop_words="english",
        ngram_range=(1, 2),
        min_df=1,
    )
    matrix = vectorizer.fit_transform(texts)
    return matrix.toarray()


def load_jsonl_sessions(
    jsonl_paths: Iterable[Path | str],
    *,
    min_chars: int = 24,
) -> list[dict[str, Any]]:
    """One node per transcript file (aggregated session text)."""
    sessions: list[dict[str, Any]] = []
    for raw_path in jsonl_paths:
        path = Path(raw_path).expanduser().resolve()
        turns = load_conversation_turns([path], min_chars=min_chars)
        if not turns:
            continue
        first = turns[0]
        text = "\n\n".join(t["text"] for t in turns)[:8000]
        source = first.get("source", "jsonl")
        sessions.append({
            "id": f"{source}:{first['project']}:{first['session_id']}",
            "label": first["session"],
            "role": "Session",
            "session": first["session"],
            "session_id": first["session_id"],
            "project": first["project"],
            "source": source,
            "topic": infer_topic(text),
            "text": text,
            "turn_count": len(turns),
        })
    return sessions


def load_sessions_from_dir(
    root: Path | str,
    *,
    include_subagents: bool = False,
    min_chars: int = 24,
    max_features: int = 256,
) -> tuple[list[dict[str, Any]], Any]:
    """Discover JSONL files under *root* and return (nodes, feature_matrix)."""
    paths = discover_jsonl_files(root, include_subagents=include_subagents)
    if not paths:
        raise FileNotFoundError(f"No .jsonl files under {root}")
    nodes = load_conversation_turns(paths, min_chars=min_chars)
    if not nodes:
        raise ValueError(f"No conversation turns with ≥{min_chars} chars in {root}")
    features = text_feature_matrix([n["text"] for n in nodes], max_features=max_features)
    return nodes, features
