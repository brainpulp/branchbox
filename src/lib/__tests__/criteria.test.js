import { classifyOrient, rgbToHsv, classifyMood, passesCriteria } from '../criteria'

test('classifyOrient buckets by aspect ratio', () => {
  expect(classifyOrient(1600, 900)).toBe('wide')
  expect(classifyOrient(900, 1600)).toBe('tall')
  expect(classifyOrient(800, 800)).toBe('square')
  expect(classifyOrient(0, 0)).toBe(null)
})

test('rgbToHsv basics', () => {
  expect(rgbToHsv(255, 0, 0).h).toBeCloseTo(0)
  expect(rgbToHsv(0, 255, 0).h).toBeCloseTo(120)
  expect(rgbToHsv(128, 128, 128).s).toBeCloseTo(0)
})

test('classifyMood splits warm / cool / mono', () => {
  expect(classifyMood({ r: 220, g: 60, b: 40 })).toBe('warm')   // red
  expect(classifyMood({ r: 230, g: 180, b: 40 })).toBe('warm')  // yellow
  expect(classifyMood({ r: 40, g: 90, b: 220 })).toBe('cool')   // blue
  expect(classifyMood({ r: 130, g: 132, b: 128 })).toBe('mono') // grey
})

test('passesCriteria narrows only on measured attributes', () => {
  const wideWarm = { orient: 'wide', mood: 'warm' }
  expect(passesCriteria(wideWarm, { orient: 'any', mood: 'any' })).toBe(true)
  expect(passesCriteria(wideWarm, { orient: 'wide' })).toBe(true)
  expect(passesCriteria(wideWarm, { orient: 'tall' })).toBe(false)
  expect(passesCriteria(wideWarm, { mood: 'cool' })).toBe(false)
  // unknown attrs never exclude
  expect(passesCriteria({}, { orient: 'wide', mood: 'cool' })).toBe(true)
})
