# Session JSONL (local only)

`*.jsonl` and prebuilt `demo_map_sessions_tsne.html` / `demo_map_cortex_tsne.html` are **gitignored** (they can contain private chat text and secrets). Keep them on your machine only.

Regenerate the map:

```bash
python3 example/generate_map_demo_sessions.py --bundled-only
```

Refresh from Cursor (all projects):

```bash
python3 example/generate_map_demo_sessions.py --export-all
```
