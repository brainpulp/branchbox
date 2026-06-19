import { expect, test } from 'vitest'
import { cosine, jaccardTagOverlap, scoreCandidate, topNeighbors } from '../similarity'

test('cosine: identical→1, orthogonal→0, opposite→-1', () => {
  expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
  expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
  expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1)
})

test('cosine: zero vector → 0 (no NaN)', () => {
  expect(cosine([0, 0], [1, 1])).toBe(0)
})

test('jaccardTagOverlap: |∩|/|∪|, 0 when either empty', () => {
  expect(jaccardTagOverlap(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3)
  expect(jaccardTagOverlap(['a'], ['a'])).toBeCloseTo(1)
  expect(jaccardTagOverlap([], ['a'])).toBe(0)
  expect(jaccardTagOverlap([], [])).toBe(0)
})

test('scoreCandidate blends cosine + λ·tagOverlap', () => {
  const src = { embedding: [1, 0], tags: ['red'] }
  const cand = { embedding: [1, 0], tags: ['red'] }
  // cosine 1 + 0.15*1 = 1.15
  expect(scoreCandidate(src, cand, 0.15)).toBeCloseTo(1.15)
})

test('topNeighbors ranks by blended score, excludes self and excludeIds, respects limit', () => {
  const src = { id: 's', embedding: [1, 0], tags: ['red'] }
  const pool = [
    { id: 's', embedding: [1, 0], tags: ['red'] },        // self → excluded
    { id: 'a', embedding: [0.9, 0.1], tags: [] },          // high cosine
    { id: 'b', embedding: [0.2, 0.98], tags: ['red'] },    // low cosine, tag nudge
    { id: 'c', embedding: [0.8, 0.2], tags: [] },          // mid cosine
    { id: 'd', embedding: [1, 0], tags: ['red'] },         // ~tied top but excluded
  ]
  const out = topNeighbors(src, pool, { limit: 2, lambda: 0.15, excludeIds: new Set(['d']) })
  expect(out.map(n => n.id)).toEqual(['a', 'c'])
  expect(out[0].score).toBeGreaterThan(out[1].score)
})

test('topNeighbors skips candidates with no embedding', () => {
  const src = { id: 's', embedding: [1, 0], tags: [] }
  const pool = [{ id: 'a', embedding: null, tags: [] }, { id: 'b', embedding: [1, 0], tags: [] }]
  expect(topNeighbors(src, pool, { limit: 5 }).map(n => n.id)).toEqual(['b'])
})
