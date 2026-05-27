import { tokenize } from "./tfidf.mjs";

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function buildVocab(texts, { maxFeatures = 512, minDf = 1 } = {}) {
  const df = new Map();
  const docTokens = texts.map(text => {
    const unigrams = tokenize(text);
    const tokens = [...unigrams];
    for (let i = 0; i < unigrams.length - 1; i++) {
      tokens.push(`${unigrams[i]} ${unigrams[i + 1]}`);
    }
    for (const t of new Set(tokens)) df.set(t, (df.get(t) || 0) + 1);
    return tokens;
  });

  const vocab = [...df.entries()]
    .filter(([, count]) => count >= minDf)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxFeatures)
    .map(([term]) => term);

  if (!vocab.length) return { vocab: [], docs: [] };

  const termToIdx = new Map(vocab.map((t, i) => [t, i]));
  const docs = docTokens.map(tokens => {
    const counts = new Map();
    for (const t of tokens) {
      const idx = termToIdx.get(t);
      if (idx != null) counts.set(idx, (counts.get(idx) || 0) + 1);
    }
    return counts;
  });

  return { vocab, docs };
}

function ldaGibbs(docs, K, V, { maxIter = 25, alpha = 0.1, beta = 0.01, seed = 42 } = {}) {
  const D = docs.length;
  if (!D || !V) return { docTopics: docs.map(() => Array(K).fill(1 / K)), topicWord: [] };

  const rand = seededRandom(seed);
  const docTopic = [];
  const topicWord = Array.from({ length: K }, () => new Array(V).fill(0));
  const docTopicCount = Array.from({ length: D }, () => new Array(K).fill(0));
  const topicTotal = new Array(K).fill(0);

  for (let d = 0; d < D; d++) {
    const positions = [];
    for (const [w, cnt] of docs[d]) {
      for (let c = 0; c < cnt; c++) {
        const z = Math.floor(rand() * K);
        positions.push({ w, z });
        docTopicCount[d][z]++;
        topicWord[z][w]++;
        topicTotal[z]++;
      }
    }
    docTopic.push(positions);
  }

  const alphaK = alpha / K;
  const betaV = beta / V;

  for (let iter = 0; iter < maxIter; iter++) {
    for (let d = 0; d < D; d++) {
      const positions = docTopic[d];
      for (const pos of positions) {
        const { w, z: oldZ } = pos;
        docTopicCount[d][oldZ]--;
        topicWord[oldZ][w]--;
        topicTotal[oldZ]--;

        let bestZ = 0;
        let bestP = -1;
        const probs = new Array(K);
        for (let k = 0; k < K; k++) {
          const p =
            (docTopicCount[d][k] + alphaK) *
            ((topicWord[k][w] + beta) / (topicTotal[k] + betaV));
          probs[k] = p;
          if (p > bestP) {
            bestP = p;
            bestZ = k;
          }
        }
        const sum = probs.reduce((a, b) => a + b, 0);
        let z = bestZ;
        if (sum > 0) {
          let r = rand() * sum;
          for (let k = 0; k < K; k++) {
            r -= probs[k];
            if (r <= 0) {
              z = k;
              break;
            }
          }
        }

        pos.z = z;
        docTopicCount[d][z]++;
        topicWord[z][w]++;
        topicTotal[z]++;
      }
    }
  }

  const docTopics = docTopicCount.map(counts => {
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    return counts.map(c => c / total);
  });

  return { docTopics, topicWord };
}

function topicLabels(topicWord, vocab, K) {
  const names = [];
  for (let k = 0; k < K; k++) {
    const weights = topicWord[k] ?? [];
    const ranked = weights
      .map((w, i) => [w, i])
      .filter(([w]) => w > 0.01)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 3)
      .map(([, i]) => vocab[i]);
    names[k] = (ranked.length ? ranked.join(" · ") : `Topic ${k + 1}`).slice(0, 56);
  }
  return names;
}

/**
 * Topic-model session texts with LDA; write labels to ``topicField``.
 * Returns map of topic index → label (top terms per topic).
 */
export function assignLdaTopics(nodes, opts = {}) {
  const textField = opts.textField ?? "text";
  const topicField = opts.topicField ?? "topic";
  const maxFeatures = opts.maxFeatures ?? 512;
  const texts = nodes.map(n => String(n[textField] ?? ""));
  const n = texts.length;

  if (n === 0) return {};
  if (n === 1) {
    nodes[0][topicField] = "General";
    return { 0: "General" };
  }

  const minDf = n > 8 ? 2 : 1;
  const { vocab, docs } = buildVocab(texts, { maxFeatures, minDf });
  if (!vocab.length) {
    for (const node of nodes) node[topicField] = "General";
    return { 0: "General" };
  }

  const nonEmpty = docs.filter(d => d.size > 0);
  if (!nonEmpty.length) {
    for (const node of nodes) node[topicField] = "General";
    return { 0: "General" };
  }

  let k = opts.nTopics;
  if (k == null || k <= 0) k = Math.min(20, Math.max(4, Math.floor(n ** 0.45)));
  const K = Math.min(Math.max(2, k), n);

  const { docTopics, topicWord } = ldaGibbs(docs, K, vocab.length, { maxIter: 25, seed: 42 });
  const labels = topicLabels(topicWord, vocab, K);

  for (let i = 0; i < n; i++) {
    const probs = docTopics[i];
    let best = 0;
    for (let t = 1; t < K; t++) {
      if (probs[t] > probs[best]) best = t;
    }
    nodes[i][topicField] = labels[best];
  }

  return Object.fromEntries(labels.map((label, i) => [i, label]));
}
