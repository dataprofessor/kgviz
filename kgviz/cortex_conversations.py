"""Load Snowflake Cortex Code conversation stores for embedding maps."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterable

from kgviz.jsonl_sessions import infer_topic, text_feature_matrix, truncate_label

DEFAULT_CORTEX_CONVERSATIONS = Path.home() / ".snowflake" / "cortex" / "conversations"

_SYSTEM_REMINDER_RE = re.compile(r"<system-reminder>.*?</system-reminder>", re.DOTALL | re.IGNORECASE)
_AGENT_MEMORY_RE = re.compile(r"<agent-memory>.*?</agent-memory>", re.DOTALL | re.IGNORECASE)
_CTX_RULE_RE = re.compile(r"\[Ctx Rule[^\]]*\][^\n]*", re.IGNORECASE)


def discover_cortex_history_files(
    root: Path | str | None = None,
) -> list[Path]:
    """All ``*.history.jsonl`` files under the Cortex conversations directory."""
    base = Path(root or DEFAULT_CORTEX_CONVERSATIONS).expanduser().resolve()
    if not base.is_dir():
        raise FileNotFoundError(f"Cortex conversations directory not found: {base}")
    return sorted(p for p in base.rglob("*.history.jsonl") if p.is_file())


def _metadata_path_for_history(history_path: Path) -> Path | None:
    session_id = history_path.name.replace(".history.jsonl", "")
    candidates = [
        history_path.with_name(f"{session_id}.json"),
        history_path.parent / f"{session_id}.json",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def load_session_metadata(history_path: Path) -> dict[str, Any]:
    meta_path = _metadata_path_for_history(history_path)
    if not meta_path:
        return {}
    try:
        data = json.loads(meta_path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def infer_workspace(history_path: Path, conversations_root: Path) -> str:
    try:
        rel = history_path.parent.relative_to(conversations_root)
    except ValueError:
        return "default"
    if str(rel) in (".", ""):
        return "default"
    return rel.parts[0]


def extract_cortex_text(record: dict[str, Any]) -> str:
    """Plain text from a Cortex history line (user/assistant)."""
    content = record.get("content")
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if not isinstance(item, dict) or item.get("type") != "text":
            continue
        if item.get("internalOnly"):
            continue
        text = item.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        cleaned = _SYSTEM_REMINDER_RE.sub("", text)
        cleaned = _AGENT_MEMORY_RE.sub("", cleaned)
        cleaned = _CTX_RULE_RE.sub("", cleaned)
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
        if cleaned:
            parts.append(cleaned)
    return "\n".join(parts).strip()


def _session_ids(history_path: Path, meta: dict[str, Any]) -> tuple[str, str]:
    session_id = str(meta.get("session_id") or history_path.stem.replace(".history", ""))
    return session_id, session_id[:8] + "…" if len(session_id) > 12 else session_id


def iter_cortex_history_records(path: Path) -> Iterable[tuple[int, dict[str, Any]]]:
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


def load_cortex_turns(
    history_paths: Iterable[Path | str],
    *,
    conversations_root: Path | str | None = None,
    min_chars: int = 24,
    include_roles: frozenset[str] | None = None,
) -> list[dict[str, Any]]:
    """One map node per user/assistant message in Cortex history JSONL files."""
    root = Path(conversations_root or DEFAULT_CORTEX_CONVERSATIONS).expanduser().resolve()
    roles = include_roles or frozenset({"user", "assistant"})
    turns: list[dict[str, Any]] = []

    for raw_path in history_paths:
        history_path = Path(raw_path).expanduser().resolve()
        if not history_path.is_file():
            continue
        meta = load_session_metadata(history_path)
        session_id, _ = _session_ids(history_path, meta)
        workspace = infer_workspace(history_path, root)
        title = str(meta.get("title") or session_id)
        session_label = truncate_label(title, 48)

        for line_no, record in iter_cortex_history_records(history_path):
            role = str(record.get("role", "")).lower()
            if role not in roles:
                continue
            text = extract_cortex_text(record)
            if len(text) < min_chars:
                continue
            display = text.split("\n")[0]
            topic = infer_topic(text)
            if meta.get("working_directory"):
                wd = str(meta["working_directory"])
                if "streamlit" in wd.lower():
                    topic = "Streamlit"
                elif "snowflake" in wd.lower() or "cortex" in wd.lower():
                    topic = topic if topic != "General" else "Snowflake / Cortex"

            turns.append({
                "id": f"{workspace}:{session_id}:{line_no}",
                "label": truncate_label(display),
                "role": role.capitalize(),
                "session": session_label,
                "session_id": session_id,
                "workspace": workspace,
                "title": title,
                "topic": topic,
                "text": text,
                "line": line_no,
                "source_file": history_path.name,
            })
    return turns


def load_cortex_sessions(
    history_paths: Iterable[Path | str],
    *,
    conversations_root: Path | str | None = None,
    min_chars: int = 24,
) -> list[dict[str, Any]]:
    """One map node per conversation session (aggregated text)."""
    root = Path(conversations_root or DEFAULT_CORTEX_CONVERSATIONS).expanduser().resolve()
    nodes: list[dict[str, Any]] = []

    for raw_path in history_paths:
        history_path = Path(raw_path).expanduser().resolve()
        if not history_path.is_file():
            continue
        meta = load_session_metadata(history_path)
        session_id, _ = _session_ids(history_path, meta)
        workspace = infer_workspace(history_path, root)
        title = str(meta.get("title") or session_id)

        chunks: list[str] = []
        first_user = ""
        for _line_no, record in iter_cortex_history_records(history_path):
            role = str(record.get("role", "")).lower()
            if role not in ("user", "assistant"):
                continue
            text = extract_cortex_text(record)
            if len(text) < min_chars:
                continue
            if role == "user" and not first_user:
                first_user = text.split("\n")[0]
            chunks.append(text)

        if not chunks:
            continue
        full_text = "\n\n".join(chunks)
        topic = infer_topic(full_text)
        nodes.append({
            "id": f"{workspace}:{session_id}",
            "label": truncate_label(title if title != session_id else (first_user or title)),
            "role": "Session",
            "session": truncate_label(title, 48),
            "session_id": session_id,
            "workspace": workspace,
            "title": title,
            "topic": topic,
            "text": full_text[:8000],
            "turn_count": len(chunks),
            "source_file": history_path.name,
        })
    return nodes


def load_cortex_from_dir(
    root: Path | str | None = None,
    *,
    per_session: bool = False,
    min_chars: int = 24,
    max_features: int = 256,
) -> tuple[list[dict[str, Any]], Any]:
    """Discover Cortex history files and return (nodes, feature_matrix)."""
    base = Path(root or DEFAULT_CORTEX_CONVERSATIONS).expanduser().resolve()
    paths = discover_cortex_history_files(base)
    if not paths:
        raise FileNotFoundError(f"No *.history.jsonl under {base}")
    if per_session:
        nodes = load_cortex_sessions(paths, conversations_root=base, min_chars=min_chars)
    else:
        nodes = load_cortex_turns(paths, conversations_root=base, min_chars=min_chars)
    if not nodes:
        raise ValueError(f"No conversation text with ≥{min_chars} chars under {base}")
    features = text_feature_matrix([n["text"] for n in nodes], max_features=max_features)
    return nodes, features
