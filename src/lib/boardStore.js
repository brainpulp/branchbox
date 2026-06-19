import { create } from 'zustand'
const uid = () => crypto.randomUUID()
export const NODE_R = 44

const useBoardStore = create((set, get) => ({
  nodes: [],            // { id, imageRef, thumbRef, w, h, embedding|null, tags[], x, y, status }
  edges: [],            // { id, source, target, kind }
  ghosts: [],           // transient suggestion nodes (not persisted)
  expandedFrom: null,   // node id currently fanned out

  loadBoardData: ({ nodes, edges }) => set({
    nodes: (nodes || []).map(n => ({ tags: [], embedding: null, status: 'ready', ...n })),
    edges: edges || [],
    ghosts: [], expandedFrom: null,
  }),

  addImageNode: ({ imageRef, thumbRef, w, h, status = 'computing' }) => {
    const id = uid()
    set(s => ({ nodes: [...s.nodes, { id, imageRef, thumbRef, w, h, embedding: null, tags: [], status }] }))
    return id
  },
  setEmbedding: (id, embedding) => set(s => ({
    nodes: s.nodes.map(n => n.id === id ? { ...n, embedding, status: 'ready' } : n),
  })),
  setNodeStatus: (id, status) => set(s => ({
    nodes: s.nodes.map(n => n.id === id ? { ...n, status } : n),
  })),
  setTags: (id, tags) => set(s => ({
    nodes: s.nodes.map(n => n.id === id ? { ...n, tags } : n),
  })),
  setNodePos: (id, x, y) => set(s => ({
    nodes: s.nodes.map(n => n.id === id ? { ...n, x, y } : n),
  })),
  deleteNode: (id) => set(s => ({
    nodes: s.nodes.filter(n => n.id !== id),
    edges: s.edges.filter(e => e.source !== id && e.target !== id),
  })),

  addBranchEdge: (source, target) => {
    if (source === target) return
    if (get().edges.some(e => e.source === source && e.target === target)) return
    set(s => ({ edges: [...s.edges, { id: uid(), source, target, kind: 'branch' }] }))
  },

  // transient expand state set by the similarity layer (M6)
  setGhosts: (expandedFrom, ghosts) => set({ expandedFrom, ghosts }),
  clearGhosts: () => set({ expandedFrom: null, ghosts: [] }),
}))

export default useBoardStore
