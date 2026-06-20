import { expect, test } from 'vitest'
import { buildSearchRequest, parsePhotos, searchPhotos, rankBySimilarity } from '../discover'

test('buildSearchRequest: pexels uses bare key auth', () => {
  const r = buildSearchRequest('pexels', 'red chair', { key: 'K', perPage: 5 })
  expect(r.url).toBe('https://api.pexels.com/v1/search?query=red%20chair&per_page=5')
  expect(r.headers).toEqual({ Authorization: 'K' })
})

test('buildSearchRequest: unsplash uses Client-ID auth', () => {
  const r = buildSearchRequest('unsplash', 'chair', { key: 'K' })
  expect(r.url).toContain('https://api.unsplash.com/search/photos?query=chair')
  expect(r.headers).toEqual({ Authorization: 'Client-ID K' })
})

test('parsePhotos normalizes pexels + unsplash shapes', () => {
  const px = parsePhotos('pexels', { photos: [{ id: 7, alt: 'a', src: { large: 'L', medium: 'M' } }] })
  expect(px[0]).toMatchObject({ id: 'pexels-7', url: 'L', thumbUrl: 'M', alt: 'a' })
  const us = parsePhotos('unsplash', { results: [{ id: 'x', alt_description: 'b', urls: { regular: 'R', small: 'S' } }] })
  expect(us[0]).toMatchObject({ id: 'unsplash-x', url: 'R', thumbUrl: 'S', alt: 'b' })
})

test('searchPhotos fetches, checks ok, and parses', async () => {
  const fetchFn = async (url, opts) => {
    expect(url).toContain('query=cat')
    expect(opts.headers.Authorization).toBe('K')
    return { ok: true, json: async () => ({ photos: [{ id: 1, src: { large: 'L', medium: 'M' } }] }) }
  }
  const out = await searchPhotos({ provider: 'pexels', key: 'K', query: 'cat', fetchFn })
  expect(out.map(p => p.id)).toEqual(['pexels-1'])
})

test('searchPhotos throws on a non-ok response', async () => {
  const fetchFn = async () => ({ ok: false, status: 429 })
  await expect(searchPhotos({ provider: 'pexels', key: 'K', query: 'x', fetchFn }))
    .rejects.toThrow('429')
})

test('rankBySimilarity orders candidates by cosine to the source, drops failures', async () => {
  const src = [1, 0]
  const candidates = [
    { id: 'far', thumbUrl: 'far' },
    { id: 'near', thumbUrl: 'near' },
    { id: 'boom', thumbUrl: 'boom' },
  ]
  const embed = async (u) => {
    if (u === 'boom') throw new Error('decode fail')
    return u === 'near' ? [0.99, 0.1] : [0.1, 0.99]
  }
  const out = await rankBySimilarity(src, candidates, { embed, limit: 5 })
  expect(out.map(c => c.id)).toEqual(['near', 'far']) // boom dropped, near ranks first
  expect(out[0].score).toBeGreaterThan(out[1].score)
})
