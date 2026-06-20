import { cosine } from './similarity'

// --- Stock-photo source adapters (pluggable) -------------------------------
// Each provider maps a text query → candidate photos {id,url,thumbUrl,alt}.
// Pure builder/parser pairs so the network shape is unit-testable.

export function buildSearchRequest(provider, query, { key, perPage = 15 } = {}) {
  const q = encodeURIComponent(query)
  if (provider === 'pexels') {
    return {
      url: `https://api.pexels.com/v1/search?query=${q}&per_page=${perPage}`,
      headers: { Authorization: key },
    }
  }
  if (provider === 'unsplash') {
    return {
      url: `https://api.unsplash.com/search/photos?query=${q}&per_page=${perPage}`,
      headers: { Authorization: `Client-ID ${key}` },
    }
  }
  throw new Error(`unknown stock provider: ${provider}`)
}

export function parsePhotos(provider, json) {
  if (provider === 'pexels') {
    return (json.photos || []).map(p => ({
      id: `pexels-${p.id}`,
      url: p.src?.large || p.src?.original,
      thumbUrl: p.src?.medium || p.src?.tiny,
      alt: p.alt || '',
    }))
  }
  if (provider === 'unsplash') {
    return (json.results || []).map(p => ({
      id: `unsplash-${p.id}`,
      url: p.urls?.regular || p.urls?.full,
      thumbUrl: p.urls?.small || p.urls?.thumb,
      alt: p.alt_description || '',
    }))
  }
  throw new Error(`unknown stock provider: ${provider}`)
}

export async function searchPhotos({ provider, key, query, perPage = 15, fetchFn = fetch }) {
  const { url, headers } = buildSearchRequest(provider, query, { key, perPage })
  const res = await fetchFn(url, { headers })
  if (!res.ok) throw new Error(`${provider} search failed: ${res.status}`)
  return parsePhotos(provider, await res.json())
}

// Embed each candidate's thumbnail with the shared CLIP pipeline and rank by
// cosine similarity to the source image's embedding. `embed` is injected so
// this is testable without the model.
export async function rankBySimilarity(srcEmbedding, candidates, { embed, limit = 5 }) {
  const scored = await Promise.all(candidates.map(async c => {
    try {
      const embedding = await embed(c.thumbUrl || c.url)
      return { ...c, embedding, score: cosine(srcEmbedding, embedding) }
    } catch {
      return null
    }
  }))
  return scored
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
