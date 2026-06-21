import { cosine } from './similarity'

// --- Visual (reverse-image) discovery via the Supabase Edge Function proxy ---
// The proxy calls SerpAPI Google Lens server-side and returns images that
// actually LOOK LIKE the source — no text query needed.

export async function searchVisual({ functionUrl, token, anonKey, imageUrl, fetchFn = fetch }) {
  const res = await fetchFn(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(anonKey ? { apikey: anonKey } : {}),
    },
    body: JSON.stringify({ imageUrl }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) throw new Error(data.error || `discover ${res.status}`)
  return data.matches || []
}

// CORS-safe URL to fetch an accepted match's bytes back through the proxy.
// apiKey (optional) is appended as a query param for contexts that can't set
// headers (e.g. an <img crossOrigin> used for colour sampling).
export function proxiedImageUrl(functionUrl, imageUrl, apiKey) {
  const base = `${functionUrl}?img=${encodeURIComponent(imageUrl)}`
  return apiKey ? `${base}&apikey=${apiKey}` : base
}

// A small vocabulary of common photographic subjects/scenes. CLIP zero-shot
// scores the source image against these to auto-derive a search query, so
// expanding a node needs no typing. Tags, when present, override this.
export const QUERY_VOCAB = [
  'chair', 'sofa', 'table', 'lamp', 'desk', 'bookshelf', 'bed', 'kitchen',
  'bathroom', 'living room', 'staircase', 'door', 'window', 'building',
  'skyscraper', 'house', 'cabin', 'bridge', 'street', 'city skyline',
  'mountain', 'forest', 'beach', 'ocean', 'lake', 'river', 'waterfall',
  'desert', 'field', 'sky', 'sunset', 'clouds', 'snow', 'flower', 'tree',
  'plant', 'garden', 'food', 'coffee', 'fruit', 'car', 'bicycle', 'boat',
  'airplane', 'train', 'road', 'dog', 'cat', 'bird', 'horse', 'person',
  'portrait', 'crowd', 'hands', 'eye', 'painting', 'sculpture', 'pattern',
  'texture', 'abstract art', 'typography', 'logo', 'poster', 'fashion',
  'shoes', 'jewelry', 'watch', 'phone', 'computer', 'machine', 'tool',
  'circuit board', 'neon lights', 'fireworks', 'candle', 'fire', 'water',
]

// Auto-derive a search query for a node. Prefer user tags (most specific);
// otherwise zero-shot classify the image against the vocabulary. `classify`
// is injected (image URL, labels[]) → [{label,score}…] so this is testable.
export async function deriveQuery(node, { classify, imageUrl, vocab = QUERY_VOCAB, topK = 2 } = {}) {
  const tags = (node?.tags || []).filter(Boolean)
  if (tags.length) return tags.slice(0, 3).join(' ')
  const scored = await classify(imageUrl, vocab)
  const top = (scored || []).slice(0, topK).map(s => s.label)
  return top.join(' ') || 'abstract'
}

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
