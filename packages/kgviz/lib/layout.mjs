import { PCA } from "ml-pca";
import TSNE from "tsne-js";
import { scaleCoords } from "./utils.mjs";

/** Final-phase iteration count for tsne-js (see layout tiers in packages/kgviz/README.md). */
export function tsneIterCount(n) {
  if (n < 300) return 500;
  if (n < 500) return 400;
  if (n < 1000) return 300;
  if (n < 1500) return 225;
  if (n < 2500) return 175;
  return 175;
}

function tsneTimeEstimate(n) {
  if (n < 300) return "<1";
  if (n < 500) return "0.5–1";
  if (n < 1000) return "1–2";
  if (n < 1500) return "2–5";
  return "4–8";
}

export async function computeLayout(matrix, method = "tsne", { randomState = 42 } = {}) {
  const n = matrix.length;
  if (n < 2) return scaleCoords([[0, 0]]);

  if (method === "pca" || (method === "tsne" && n > 2500)) {
    if (method === "tsne" && n > 2500) {
      console.warn(
        `Using PCA for ${n} points (Node t-SNE is impractical above ~2500; use --method pca, --max-points, or Python kgviz).`,
      );
    }
    const pca = new PCA(matrix, { center: true, scale: false });
    const out = pca.predict(matrix, { nComponents: 2 });
    const rows = out.to2DArray ? out.to2DArray() : out;
    return scaleCoords(rows);
  }

  const pca = new PCA(matrix, { center: true, scale: false });
  const initRaw = pca.predict(matrix, { nComponents: 2 });
  const init = initRaw.to2DArray ? initRaw.to2DArray() : initRaw;
  const perp = Math.min(30, Math.max(5, Math.floor((n - 1) / 3)));

  const nIter = tsneIterCount(n);
  console.error(
    `  t-SNE on ${n} points, nIter=${nIter} (~${tsneTimeEstimate(n)} min in Node; use --method pca for instant layout)…`,
  );

  const tsne = new TSNE({
    dim: 2,
    perplexity: perp,
    earlyExaggeration: 4,
    learningRate: 100,
    nIter,
    metric: "euclidean",
  });

  tsne.on("progressStatus", msg => {
    console.error(`  ${msg}…`);
  });
  tsne.on("progressIter", ([iter, error]) => {
    if (iter % 50 === 0) {
      console.error(`  t-SNE iteration ${iter} (KL ${error.toFixed(4)})`);
    }
  });

  tsne.init({ data: init, type: "dense" });
  const t0 = Date.now();
  tsne.run();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(`  t-SNE finished in ${elapsed}s`);
  const out = tsne.getOutput();
  return scaleCoords(out.map(row => [row[0], row[1]]));
}
