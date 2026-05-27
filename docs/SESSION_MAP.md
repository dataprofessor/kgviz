# AI session map (Cortex + Cursor + Claude)

Build one interactive embedding map from your local agent chat history. **Nothing is uploaded** — files stay on your machine; the HTML output is gitignored by default.

## Prerequisites

- **Python 3.9+**
- Chat history on disk from at least one tool (see table below)
- A terminal and a web browser

## 1. Install kgviz

**From PyPI:**

```bash
pip install "kgviz[maps]"
```

**From GitHub (latest):**

```bash
git clone https://github.com/dataprofessor/kgviz.git
cd kgviz
pip install -e ".[maps]"
```

The `[maps]` extra installs NumPy and scikit-learn for PCA / t-SNE layouts.

## 2. Where your chats live

| Tool | Default location on your computer |
|------|----------------------------------|
| **Snowflake Cortex Code** | `~/.snowflake/cortex/conversations/**/*.history.jsonl` |
| **Cursor IDE** | `~/.cursor/projects/*/agent-transcripts/**/*.jsonl` |
| **Claude Code (CLI)** | `~/.claude/projects/<project>/*.jsonl` |

`~` means your home directory (e.g. `/Users/you` on macOS, `/home/you` on Linux).

## 3. Build the combined map (all three tools)

**If you installed from PyPI**, download the generator script once:

```bash
curl -fsSL https://raw.githubusercontent.com/dataprofessor/kgviz/main/example/generate_map_demo_sessions.py \
  -o generate_map_demo_sessions.py
```

Then run:

```bash
python3 generate_map_demo_sessions.py \
  --source all \
  --per-session \
  --method tsne \
  --color-by topic \
  --topic-model lda \
  --max-points 1500 \
  -o sessions_map.html
```

**If you cloned the repo**, run from the repository root:

```bash
python3 example/generate_map_demo_sessions.py \
  --source all \
  --per-session \
  --method tsne \
  --color-by topic \
  --topic-model lda \
  --max-points 1500
```

That writes `demo_map_sessions_tsne.html` in the `example/` folder (when using the repo script without `-o`).

### What the flags mean

| Flag | Purpose |
|------|---------|
| `--source all` | Cortex + Cursor + Claude |
| `--per-session` | One dot per conversation (omit for one dot per message) |
| `--method tsne` | t-SNE layout (`pca` is faster for a quick preview) |
| `--color-by topic` | Color dots by LDA topic cluster (default) |
| `--topic-model lda` | Run Latent Dirichlet Allocation on session text (default) |
| `--topic-model rules` | Keyword rules instead of LDA (older behavior) |
| `--n-topics 12` | Fix LDA to 12 topics (0 = auto, ~4–20) |
| `--color-by source` | Color dots by tool (cortex / cursor / claude) |
| `--max-points 1500` | Cap total points if you have thousands of Cortex sessions |

### Custom data directories

```bash
python3 generate_map_demo_sessions.py \
  --source all \
  --per-session \
  --cortex-dir ~/.snowflake/cortex/conversations \
  --cursor-dir ~/.cursor/projects \
  --claude-dir ~/.claude/projects \
  --color-by source \
  -o sessions_map.html
```

## 4. Open the map in your browser

**Option A — Python server (repo clone):**

```bash
python3 example/serve_demo.py
```

Open **http://127.0.0.1:8765/demo_map_sessions_tsne.html**

**Option B — Any static file:**

```bash
python3 -m http.server 8765 --directory .
```

Open **http://127.0.0.1:8765/sessions_map.html** (or whatever you passed to `-o`).

**Option C — npm CLI (no Python generator):**

```bash
npx kgviz sessions --source all --per-session --color-by topic --topic-model lda -o sessions.html
npx kgviz sessions --source all --per-session --color-by source --topic-model rules -o sessions.html
npx kgviz serve sessions.html
```

Follow the URL printed in the terminal.

## 5. Single-tool maps

```bash
# Cursor only
python3 generate_map_demo_sessions.py --source cursor --per-session --color-by project -o cursor_map.html

# Claude Code only
python3 generate_map_demo_sessions.py --source claude --per-session -o claude_map.html

# Cortex only (default source)
python3 generate_map_demo_sessions.py --source cortex --per-session -o cortex_map.html
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Only 1–2 dots on the map | You likely built from `--source claude` only. Use `--source cursor` or `--source all`. |
| `No conversation text found` | Check paths; confirm JSONL files exist under the directories above. |
| t-SNE very slow | Use `--method pca` first, or `--max-points 500`. |
| Map shows old data | Re-run the generator, then hard-refresh the browser (Cmd+Shift+R). |
| Privacy | Do not commit `*_sessions*.html` or `*.jsonl` chat exports to a public repo. |

## Privacy

Generated HTML embeds **snippets of your chat text** for tooltips and search. Treat output files like private data.
