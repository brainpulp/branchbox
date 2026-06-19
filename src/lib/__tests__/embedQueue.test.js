import { expect, test, vi } from 'vitest'
import { createEmbedQueue } from '../embedQueue'

test('processes jobs sequentially and reports ready per id', async () => {
  const order = []
  const fakeEmbed = vi.fn(async (url) => { order.push(url); return [url.length] })
  const ready = []
  const q = createEmbedQueue({ embed: fakeEmbed, onReady: (id, vec) => ready.push([id, vec]) })
  q.enqueue('n1', 'aa')
  q.enqueue('n2', 'bbb')
  await q.drain()
  expect(order).toEqual(['aa', 'bbb'])          // sequential, FIFO
  expect(ready).toEqual([['n1', [2]], ['n2', [3]]])
})

test('an error on one job does not stall the queue', async () => {
  const fakeEmbed = vi.fn(async (url) => { if (url === 'x') throw new Error('boom'); return [1] })
  const errors = [], ready = []
  const q = createEmbedQueue({ embed: fakeEmbed, onReady: (id) => ready.push(id), onError: (id) => errors.push(id) })
  q.enqueue('bad', 'x'); q.enqueue('good', 'y')
  await q.drain()
  expect(errors).toEqual(['bad'])
  expect(ready).toEqual(['good'])
})
