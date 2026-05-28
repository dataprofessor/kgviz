# Changelog

## 0.2.2 (2026-05-28)

### Session maps (Python + npm CLI)

- **LDA topic modeling** — `--topic-model lda` (default) with `--n-topics`; keyword fallback via `--topic-model rules`
- **3D embeddings** — layouts compute `x`/`y`/`z` so **2D** (default) and **3D** toolbar views both work
- **npm t-SNE fix** — use `tsne-js` `run()` API (fixes `tsne.step is not a function`)
- **npm t-SNE UX** — progress output, time estimates, and scaled `nIter` by point count
- **Custom output path** — `-o` / `--output` on Python generator and npm `sessions`

### Python

- `assign_lda_topics()` in `kgviz.jsonl_sessions`
- `scale_coords()` scales all three axes uniformly
- `docs/SESSION_MAP.md` walkthrough

### npm (`npx kgviz`)

- `lib/lda.mjs` — pure-JS LDA for session coloring
- `lib/layout.mjs` — 3D t-SNE/PCA, `MAP_EMBED_DIM = 3`

## 0.2.1

- Initial published session-map release with LDA and npm t-SNE `run()` fix (partial npm UX improvements).

## 0.2.0

- Framework examples (Gradio, Dash, marimo), browser tests, npm CLI for sessions.
