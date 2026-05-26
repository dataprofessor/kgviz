const STOP = new Set(
  "a an the and or but in on at to for of is are was were be been being have has had do does did will would could should may might must can this that these those it its i you he she they we my your our their".split(" "),
);

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP.has(t));
}

export function buildTfidfMatrix(texts, maxFeatures = 256) {
  const docs = texts.map(tokenize);
  const df = new Map();
  for (const tokens of docs) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) || 0) + 1);
  }
  const vocab = [...df.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxFeatures)
    .map(([term]) => term);
  const idf = vocab.map(term => Math.log((1 + docs.length) / (1 + (df.get(term) || 0))) + 1);
  const matrix = docs.map(tokens => {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const len = tokens.length || 1;
    return vocab.map((term, j) => {
      const f = (tf.get(term) || 0) / len;
      return f * idf[j];
    });
  });
  return matrix;
}
