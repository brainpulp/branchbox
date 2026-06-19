import { pipeline, env } from '@huggingface/transformers'

env.allowLocalModels = false   // fetch from HF CDN

let _pipe = null
let _loadState = 'idle'        // 'idle' | 'loading' | 'ready' | 'error'
const _listeners = new Set()
export const onEmbedderState = (fn) => { _listeners.add(fn); return () => _listeners.delete(fn) }
const _emit = (s) => { _loadState = s; _listeners.forEach(fn => fn(s)) }
export const embedderState = () => _loadState

export async function ensureEmbedder() {
  if (_pipe) return _pipe
  _emit('loading')
  try {
    // try WebGPU, fall back to wasm
    try {
      _pipe = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32', { device: 'webgpu' })
    } catch {
      _pipe = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32')
    }
    _emit('ready')
    return _pipe
  } catch (e) {
    _emit('error')
    throw e
  }
}

// blobUrl: an object URL for the (downscaled) image
export async function embedImage(blobUrl) {
  const pipe = await ensureEmbedder()
  const out = await pipe(blobUrl, { pooling: 'mean', normalize: true })
  return Array.from(out.data)   // plain JS number[] for JSONB
}
