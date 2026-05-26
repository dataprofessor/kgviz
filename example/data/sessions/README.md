# Private session data (local only — never commit)

These paths are **gitignored**:

| Pattern | Contents |
|---------|----------|
| `*.jsonl` here | Cursor agent transcripts (bundled copies) |
| `~/.snowflake/cortex/conversations/**/*.history.jsonl` | Snowflake Cortex sessions (read by generators, not stored in repo) |
| `../demo_map_sessions_tsne.html` | Map built from Cortex/Cursor text |
| `../demo_map_cortex_tsne.html` | Legacy Cortex-only map |

Maps can embed secrets (e.g. webhook URLs in chat). Regenerate locally only.

Regenerate the Cortex/session map:

```bash
python3 example/generate_map_demo_sessions.py --bundled-only
```

Refresh from Cursor (all projects):

```bash
python3 example/generate_map_demo_sessions.py --export-all
```
