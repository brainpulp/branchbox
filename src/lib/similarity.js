export const DEFAULT_LAMBDA = 0.15

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export function jaccardTagOverlap(t1, t2) {
  if (!t1?.length || !t2?.length) return 0
  const s1 = new Set(t1), s2 = new Set(t2)
  let inter = 0
  for (const t of s1) if (s2.has(t)) inter++
  const union = s1.size + s2.size - inter
  return union === 0 ? 0 : inter / union
}

export function scoreCandidate(src, cand, lambda = DEFAULT_LAMBDA) {
  return cosine(src.embedding, cand.embedding) + lambda * jaccardTagOverlap(src.tags, cand.tags)
}

export function topNeighbors(src, pool, { limit = 5, lambda = DEFAULT_LAMBDA, excludeIds = new Set() } = {}) {
  return pool
    .filter(n => n.id !== src.id && !excludeIds.has(n.id) && Array.isArray(n.embedding))
    .map(n => ({ ...n, score: scoreCandidate(src, n, lambda) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
