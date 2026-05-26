# kgviz-session-map (deprecated)

Use the main **`kgviz`** npm package instead:

```bash
npx kgviz sessions --source cortex -o my-map.html
npx kgviz serve my-map.html
```

This package remains as a backward-compatible alias for `kgviz sessions`.

## Data sources

| `--source` | Reads from |
|------------|------------|
| `cortex` (default) | `~/.snowflake/cortex/conversations/**/*.history.jsonl` |
| `cursor` | `~/.cursor/projects/*/agent-transcripts/**/*.jsonl` |
| `all` | Both combined (color with `--color-by source`) |

## Options

```
--cortex-dir <path>     Override Cortex conversations root
--cursor-dir <path>     Override Cursor projects root
--method tsne|pca       Layout algorithm (default: tsne)
--color-by <field>      topic | role | source | session | workspace | project
--min-chars 24          Skip short messages
--max-points 2000       Subsample for faster builds
--open                  Open HTML in browser after build
```

## t-SNE note

The Node CLI runs full t-SNE up to **4,000** points. Larger histories automatically fall back to **PCA** (with a warning). For 10k+ point t-SNE, use the Python path:

```bash
pip install "kgviz[maps]"
python3 example/generate_map_demo_sessions.py
```

## Install globally

```bash
npm install -g kgviz-session-map
kgviz-session-map --source all -o session-map.html
```

## Publish

From this directory (after `cd viewer && npm run build` in the repo root):

```bash
npm install
npm run prepare-viewer
npm publish --access public
```

## License

MIT
