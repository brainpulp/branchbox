// Pure helpers for the "fine-tune" discovery criteria (shape + colour).
// DOM-free so they unit-test cleanly; the Board feeds them dims/pixels it
// measures from the candidate thumbnails.

// Orientation ("shape") bucket from pixel dimensions.
export function classifyOrient(w, h) {
  if (!w || !h) return null
  const r = w / h
  if (r >= 1.2) return 'wide'
  if (r <= 0.83) return 'tall'
  return 'square'
}

// Average RGB → HSV (h in degrees, s/v in 0..1).
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

// Colour "mood" bucket from an average RGB colour.
export function classifyMood({ r, g, b }) {
  const { h, s } = rgbToHsv(r, g, b)
  if (s < 0.18) return 'mono'
  if (h < 70 || h >= 330) return 'warm'
  return 'cool'
}

// Does a candidate pass the active criteria? Unknown attributes (analysis
// failed / still pending) never exclude — the filter only ever narrows on
// what we actually measured.
export function passesCriteria(c, { orient = 'any', mood = 'any' } = {}) {
  if (orient !== 'any' && c.orient && c.orient !== orient) return false
  if (mood !== 'any' && c.mood && c.mood !== mood) return false
  return true
}
