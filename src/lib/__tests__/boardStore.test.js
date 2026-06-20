import { beforeEach, expect, test } from 'vitest'
import useBoardStore from '../boardStore'

const reset = () => useBoardStore.setState({ nodes: [], edges: [], ghosts: [], expandedFrom: null })
beforeEach(reset)

test('addImageNode appends a node and returns its id', () => {
  const id = useBoardStore.getState().addImageNode({ imageRef: 'b/n.jpg', thumbRef: 'b/n.thumb.jpg', w: 100, h: 80 })
  const { nodes } = useBoardStore.getState()
  expect(nodes).toHaveLength(1)
  expect(nodes[0].id).toBe(id)
  expect(nodes[0].imageRef).toBe('b/n.jpg')
  expect(nodes[0].tags).toEqual([])
  expect(nodes[0].embedding).toBeNull()
})

test('setEmbedding attaches a vector to a node', () => {
  const id = useBoardStore.getState().addImageNode({ imageRef: 'a', thumbRef: 'a', w: 1, h: 1 })
  useBoardStore.getState().setEmbedding(id, [0.1, 0.2])
  expect(useBoardStore.getState().nodes[0].embedding).toEqual([0.1, 0.2])
})

test('addBranchEdge creates a provenance edge with kind=branch and dedupes', () => {
  const a = useBoardStore.getState().addImageNode({ imageRef: 'a', thumbRef: 'a', w: 1, h: 1 })
  const b = useBoardStore.getState().addImageNode({ imageRef: 'b', thumbRef: 'b', w: 1, h: 1 })
  useBoardStore.getState().addBranchEdge(a, b)
  useBoardStore.getState().addBranchEdge(a, b) // duplicate ignored
  const { edges } = useBoardStore.getState()
  expect(edges).toHaveLength(1)
  expect(edges[0]).toMatchObject({ source: a, target: b, kind: 'branch' })
})

test('deleteNode removes the node and its edges', () => {
  const a = useBoardStore.getState().addImageNode({ imageRef: 'a', thumbRef: 'a', w: 1, h: 1 })
  const b = useBoardStore.getState().addImageNode({ imageRef: 'b', thumbRef: 'b', w: 1, h: 1 })
  useBoardStore.getState().addBranchEdge(a, b)
  useBoardStore.getState().deleteNode(a)
  expect(useBoardStore.getState().nodes).toHaveLength(1)
  expect(useBoardStore.getState().edges).toHaveLength(0)
})

test('addImageNode stores a hash when provided', () => {
  const id = useBoardStore.getState().addImageNode({ imageRef: 'a', thumbRef: 'a', w: 1, h: 1, hash: 'deadbeef' })
  expect(useBoardStore.getState().nodes[0].hash).toBe('deadbeef')
})

test('setNodeRefs updates image/thumb paths', () => {
  const id = useBoardStore.getState().addImageNode({ imageRef: null, thumbRef: null, w: 1, h: 1 })
  useBoardStore.getState().setNodeRefs(id, 'b/n.jpg', 'b/n.thumb.jpg')
  expect(useBoardStore.getState().nodes[0]).toMatchObject({ imageRef: 'b/n.jpg', thumbRef: 'b/n.thumb.jpg' })
})

test('setTags replaces a node tag set', () => {
  const a = useBoardStore.getState().addImageNode({ imageRef: 'a', thumbRef: 'a', w: 1, h: 1 })
  useBoardStore.getState().setTags(a, ['red', 'chair'])
  expect(useBoardStore.getState().nodes[0].tags).toEqual(['red', 'chair'])
})

test('loadBoardData replaces topology', () => {
  useBoardStore.getState().loadBoardData({ nodes: [{ id: 'x', tags: [], embedding: null }], edges: [] })
  expect(useBoardStore.getState().nodes[0].id).toBe('x')
})
