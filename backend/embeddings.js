function cosineSimilarity(vec1, vec2) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vec1.length; i++) {
    dot += vec1[i] * vec2[i];
    normA += vec1[i] * vec1[i];
    normB += vec2[i] * vec2[i];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = { cosineSimilarity };