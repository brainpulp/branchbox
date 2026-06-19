export function fitDimensions(w, h, maxEdge) {
  const longest = Math.max(w, h)
  if (longest <= maxEdge) return { w, h }
  const k = maxEdge / longest
  return { w: Math.round(w * k), h: Math.round(h * k) }
}

export async function hashBytes(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// Canvas-touching (verified manually in M5): decode → downscale → JPEG blob
export async function downscaleImage(blob, maxEdge = 1600, quality = 0.85) {
  const bmp = await createImageBitmap(blob)
  const { w, h } = fitDimensions(bmp.width, bmp.height, maxEdge)
  const canvas = new OffscreenCanvas(w, h)
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality })
  return { blob: out, w, h }
}

export async function makeThumbnail(blob, maxEdge = 256, quality = 0.8) {
  return (await downscaleImage(blob, maxEdge, quality)).blob
}
