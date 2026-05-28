import { PCA } from "ml-pca";
import TSNE from "tsne-js";
import { scaleCoords } from "./utils.mjs";

export async function computeLayout(matrix, method = "tsne", { randomState = 42 } = {}) {
  const n = matrix.length;
  if (n < 2) return scaleCoords([[0, 0]]);

  if (method === "pca" || (method === "tsne" && n > 4000)) {
    if (method === "tsne" && n > 4000) {
      console.warn(`Using PCA for ${n} points (t-SNE capped at 4000 in Node CLI; use Python kgviz for full t-SNE).`);
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

  const nIter = n > 2000 ? 350 : 500;
  const tsne = new TSNE({
    dim: 2,
    perplexity: perp,
    earlyExaggeration: 4,
    learningRate: 100,
    nIter,
    metric: "euclidean",
  });

  tsne.init({ data: init, type: "dense" });
  tsne.run();
  const out = tsne.getOutput();
  return scaleCoords(out.map(row => [row[0], row[1]]));
}
