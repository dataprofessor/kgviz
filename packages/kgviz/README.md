# kgviz (npm)

CLI for the [kgviz](https://github.com/dataprofessor/kgviz) 3D graph viewer — no Python required for HTML export and session maps.

**Install:** [npmjs.com/package/kgviz](https://www.npmjs.com/package/kgviz)

```bash
npx kgviz help              # run once, no install
npm install -g kgviz        # then: kgviz help
```

## Commands

### `kgviz build` — graph from JSON

```bash
npx kgviz build graph.json -o graph.html
npx kgviz build graph.json --map --color-by type
npx kgviz build --nodes nodes.json --edges edges.json -o out.html
```

**graph.json** shape:

```json
{
  "nodes": [
    { "id": "A", "label": "Alpha", "color": "#ff6b6b", "size": 8 }
  ],
  "edges": [
    { "source": "A", "target": "B" }
  ],
  "show_legend": true,
  "map_mode": false,
  "default_view": "3d"
}
```

Nodes with `x`, `y` (and optional `z`) use fixed coordinates (`use_coordinates`).

### `kgviz sessions` — AI coding session maps

Cluster **Cortex Code**, **Cursor IDE**, or **Claude Code** transcripts into one interactive map.

```bash
npx kgviz sessions --per-session -o sessions.html
npx kgviz sessions --source claude --color-by project
npx kgviz sessions --source all --color-by source
npx kgviz sessions --source cortex --method pca
```

| Flag | Description |
|------|-------------|
| `--source` | `cortex` \| `cursor` \| `claude` \| `all` |
| `--per-session` | One node per chat (not per message) |
| `--cortex-dir` | Default `~/.snowflake/cortex/conversations` |
| `--cursor-dir` | Default `~/.cursor/projects` (agent-transcripts) |
| `--claude-dir` | Default `~/.claude/projects` (Claude Code CLI) |
| `--method` | `tsne` \| `pca` (t-SNE capped at 4k points in Node) |

### `kgviz serve` — local preview

```bash
npx kgviz serve graph.html --port 8765
```

## Python package

For Jupyter, Streamlit, full t-SNE/UMAP on 10k+ points, and NetworkX integration:

```bash
pip install "kgviz[maps]"
```

## Publish

From repo root (after `cd viewer && npm run build`):

```bash
cd packages/kgviz && npm install && npm run prepare-viewer && npm publish --access public
```

## License

MIT
