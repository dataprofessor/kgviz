# Private session data (local only — never commit)

These paths are **gitignored**:

| Pattern | Contents |
|---------|----------|
| `*.jsonl` here | Cursor agent transcripts (bundled copies) |
| `~/.snowflake/cortex/conversations/**/*.history.jsonl` | Snowflake Cortex sessions (read by generators, not stored in repo) |
| `../demo_map_sessions_tsne.html` | Map built from Cortex/Cursor text |
| `../demo_map_cortex_tsne.html` | Legacy Cortex-only map |

Maps can embed secrets (e.g. webhook URLs in chat). Regenerate locally only.

Regenerate locally (outputs are gitignored):

```bash
# Snowflake Cortex Code
python3 example/generate_map_demo_sessions.py --per-session

# Cursor IDE
python3 example/generate_map_demo_sessions.py --source cursor --per-session

# Claude Code CLI (~/.claude/projects)
python3 example/generate_map_demo_sessions.py --source claude --per-session

# All sources
python3 example/generate_map_demo_sessions.py --source all --color-by source
```
