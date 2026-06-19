import { expect, test } from 'vitest'
import { fitDimensions, hashBytes } from '../imageUtils'

test('fitDimensions scales the longest edge down to max, preserving aspect', () => {
  expect(fitDimensions(3200, 1600, 1600)).toEqual({ w: 1600, h: 800 })
  expect(fitDimensions(800, 1200, 1600)).toEqual({ w: 800, h: 1200 }) // already under max → unchanged
  expect(fitDimensions(1600, 3200, 1600)).toEqual({ w: 800, h: 1600 })
})

test('hashBytes is stable and content-addressed', async () => {
  const a = new Uint8Array([1, 2, 3]).buffer
  const b = new Uint8Array([1, 2, 3]).buffer
  const c = new Uint8Array([1, 2, 4]).buffer
  const ha = await hashBytes(a)
  expect(await hashBytes(b)).toBe(ha)   // same content → same hash
  expect(await hashBytes(c)).not.toBe(ha)
  expect(ha).toMatch(/^[0-9a-f]{64}$/)  // sha-256 hex
})
