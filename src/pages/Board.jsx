/* eslint-disable react-hooks/refs -- D3↔React pattern: live sim positions live in
   mutable refs (simNodesRef/simEdgesRef/zoomTransformRef) and are read during render;
   re-renders are driven by the rAF-throttled setTick. This is the documented integration. */
import { useCallback, useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import useBoardStore, { NODE_R } from '../lib/boardStore'
import ImageNode from '../components/ImageNode'
import ImportDropzone from '../components/ImportDropzone'
import { hashBytes, downscaleImage, makeThumbnail } from '../lib/imageUtils'
import { uploadImage, publicUrl } from '../lib/db'
import { embedImage, onEmbedderState } from '../lib/embedder'
import { createEmbedQueue } from '../lib/embedQueue'

// Lean fork of PIM's Graph.jsx D3↔React integration: sim in simRef, live
// positions in mutable simNodesRef, React re-renders via rAF-throttled setTick.
export default function Board({ boardId }) {
  const svgRef = useRef()
  const simRef = useRef(null)
  const simNodesRef = useRef([])
  const simEdgesRef = useRef([])
  const zoomBehaviorRef = useRef(null)
  const zoomTransformRef = useRef(d3.zoomIdentity)
  const frameRef = useRef(null)
  const [, setTick] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [toast, setToast] = useState(null)
  const [embedderStatus, setEmbedderStatus] = useState('idle') // idle|loading|ready|error
  const toastTimerRef = useRef(null)
  const queueRef = useRef(null)

  const storeNodes = useBoardStore(s => s.nodes)
  const storeEdges = useBoardStore(s => s.edges)
  const addImageNode = useBoardStore(s => s.addImageNode)
  const setNodeRefs = useBoardStore(s => s.setNodeRefs)
  const setNodePos = useBoardStore(s => s.setNodePos)
  const loadBoardData = useBoardStore(s => s.loadBoardData)

  const showToast = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 2800)
  }, [])

  // Embed queue: revoke the object URL once embedding settles; store actions
  // are read fresh via getState() to avoid stale closures.
  if (!queueRef.current) {
    queueRef.current = createEmbedQueue({
      embed: async (url) => { try { return await embedImage(url) } finally { URL.revokeObjectURL(url) } },
      onReady: (id, embedding) => useBoardStore.getState().setEmbedding(id, embedding),
      onError: (id) => useBoardStore.getState().setNodeStatus(id, 'error'),
    })
  }

  // Import pipeline: hash-dedup → downscale + thumb → computing node → upload →
  // refs → enqueue for embedding (flips computing → ready).
  const importFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'))
    for (const file of files) {
      try {
        const hash = await hashBytes(await file.arrayBuffer())
        if (useBoardStore.getState().nodes.some(n => n.hash === hash)) {
          showToast('Skipped a duplicate image'); continue
        }
        const { blob: fullBlob, w, h } = await downscaleImage(file)
        const thumbBlob = await makeThumbnail(file)
        const nodeId = addImageNode({ imageRef: null, thumbRef: null, w, h, hash, status: 'computing' })
        try {
          const fullPath = await uploadImage(fullBlob, boardId, nodeId, 'full')
          const thumbPath = await uploadImage(thumbBlob, boardId, nodeId, 'thumb')
          setNodeRefs(nodeId, fullPath, thumbPath)
          queueRef.current.enqueue(nodeId, URL.createObjectURL(fullBlob))
        } catch {
          useBoardStore.getState().setNodeStatus(nodeId, 'error')
          showToast('Upload failed — check the storage bucket')
        }
      } catch {
        showToast('Could not read an image')
      }
    }
  }, [boardId, addImageNode, setNodeRefs, showToast])

  // Reflect the shared CLIP-model load state in a status chip.
  useEffect(() => onEmbedderState(setEmbedderStatus), [])

  // On model-load failure: re-enqueue every node that never reached `ready`,
  // resolving its uploaded image back to a URL the embedder can read.
  const retryEmbeddings = useCallback(() => {
    useBoardStore.getState().nodes
      .filter(n => n.status !== 'ready' && n.imageRef)
      .forEach(n => queueRef.current.enqueue(n.id, publicUrl(n.imageRef)))
  }, [])

  // Each board open starts from a clean in-session canvas (persistence lands in M7).
  useEffect(() => { loadBoardData({ nodes: [], edges: [] }) }, [boardId, loadBoardData])

  const scheduleRender = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => { frameRef.current = null; setTick(t => t + 1) })
  }, [])

  // Topology → sim: reconcile live nodes (keep positions of survivors), rebuild sim.
  useEffect(() => {
    const posById = {}
    simNodesRef.current.forEach(n => { posById[n.id] = { x: n.x, y: n.y, vx: n.vx, vy: n.vy, fx: n.fx, fy: n.fy } })
    const cx = (svgRef.current?.clientWidth || 1000) / 2
    const cy = (svgRef.current?.clientHeight || 700) / 2
    simNodesRef.current = storeNodes.map(n => {
      const p = posById[n.id]
      return {
        id: n.id,
        x: p?.x ?? cx + (Math.random() - 0.5) * 120,
        y: p?.y ?? cy + (Math.random() - 0.5) * 120,
        vx: p?.vx ?? 0, vy: p?.vy ?? 0,
        fx: p?.fx ?? null, fy: p?.fy ?? null,
      }
    })
    const nodeById = Object.fromEntries(simNodesRef.current.map(n => [n.id, n]))
    simEdgesRef.current = storeEdges
      .filter(e => nodeById[e.source] && nodeById[e.target])
      .map(e => ({ id: e.id, source: nodeById[e.source], target: nodeById[e.target] }))

    if (!simRef.current) {
      simRef.current = d3.forceSimulation(simNodesRef.current)
        .force('link', d3.forceLink(simEdgesRef.current).id(d => d.id).distance(120).strength(0.4))
        .force('charge', d3.forceManyBody().strength(-300))
        .force('collide', d3.forceCollide(NODE_R + 8))
        .alphaDecay(0.04).velocityDecay(0.5).alphaMin(0.005)
        .on('tick', scheduleRender)
    } else {
      simRef.current.nodes(simNodesRef.current)
        .force('link', d3.forceLink(simEdgesRef.current).id(d => d.id).distance(120).strength(0.4))
        .alpha(0.5).restart()
    }
    scheduleRender()
  }, [storeNodes, storeEdges, scheduleRender])

  // Zoom/pan — pan only on background (not on nodes).
  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)
    zoomBehaviorRef.current = d3.zoom()
      .scaleExtent([0.1, 8])
      .filter(e => !e.target.closest?.('[data-node]'))
      .on('zoom', e => { zoomTransformRef.current = e.transform; scheduleRender() })
    svg.call(zoomBehaviorRef.current)
    svg.on('dblclick.zoom', null)
    return () => svg.on('.zoom', null)
  }, [scheduleRender])

  const clientToSim = useCallback((clientX, clientY) => {
    const rect = svgRef.current.getBoundingClientRect()
    return zoomTransformRef.current.invert([clientX - rect.left, clientY - rect.top])
  }, [])

  // Drag a node → anchor it (fx/fy on the live sim node) and persist x/y to the store.
  const handleNodeMouseDown = useCallback((e, nodeId) => {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    setSelectedId(nodeId)
    const simNode = simNodesRef.current.find(n => n.id === nodeId)
    if (!simNode) return
    simRef.current.alphaTarget(0.3).restart()
    const [startSx, startSy] = clientToSim(e.clientX, e.clientY)
    const ox = simNode.fx ?? simNode.x ?? 0
    const oy = simNode.fy ?? simNode.y ?? 0
    let didDrag = false

    const onMove = me => {
      const [sx, sy] = clientToSim(me.clientX, me.clientY)
      const ddx = sx - startSx, ddy = sy - startSy
      if (!didDrag && Math.abs(ddx) < 2 && Math.abs(ddy) < 2) return
      if (!didDrag) document.body.style.cursor = 'grabbing'
      didDrag = true
      simNode.fx = ox + ddx; simNode.fy = oy + ddy
    }
    const onUp = () => {
      document.body.style.cursor = ''
      simRef.current.alphaTarget(0)
      if (didDrag) setNodePos(nodeId, simNode.fx, simNode.fy) // keep anchored
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [clientToSim, setNodePos])

  const T = zoomTransformRef.current
  const nodeById = Object.fromEntries(storeNodes.map(n => [n.id, n]))

  return (
    <ImportDropzone onFiles={importFiles}>
      <svg ref={svgRef} style={{ width: '100%', height: '100%', background: '#0c0c1a', display: 'block' }}
        onClick={() => setSelectedId(null)}>
        <defs>
          <marker id="bb-arr" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L0,8 L8,4 z" fill="#334155" />
          </marker>
        </defs>
        <g transform={`translate(${T.x},${T.y}) scale(${T.k})`}>
          {simEdgesRef.current.map(e => {
            const s = e.source, t = e.target
            if (!s || !t || s.x == null) return null
            return <line key={e.id} x1={s.x} y1={s.y} x2={t.x} y2={t.y}
              stroke="#334155" strokeWidth={1.5} markerEnd="url(#bb-arr)" />
          })}
          {simNodesRef.current.map(sn => {
            const data = nodeById[sn.id]
            if (!data) return null
            return <ImageNode key={sn.id} node={data} x={sn.x} y={sn.y}
              isSelected={selectedId === sn.id} onMouseDown={handleNodeMouseDown} />
          })}
        </g>
      </svg>
      {embedderStatus === 'loading' && (
        <div style={chipStyle}>loading similarity model…</div>
      )}
      {embedderStatus === 'error' && (
        <div style={{ ...chipStyle, borderColor: '#7a2d3a', color: '#ffc5d0' }}>
          similarity model failed
          <button style={retryBtn} onClick={retryEmbeddings}>retry</button>
        </div>
      )}
      {toast && <div style={toastStyle}>{toast}</div>}
    </ImportDropzone>
  )
}

const toastStyle = {
  position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
  padding: '0.5rem 0.9rem', borderRadius: 8, background: '#1a1a2e', border: '1px solid #2d3a6a',
  color: '#c5d0ff', fontSize: '0.82rem', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
}

const chipStyle = {
  position: 'absolute', top: 12, right: 12, zIndex: 30,
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '0.4rem 0.7rem', borderRadius: 8, background: '#111118', border: '1px solid #2d3a6a',
  color: '#8090b8', fontSize: '0.78rem',
}

const retryBtn = {
  padding: '0.15rem 0.5rem', borderRadius: 6, border: '1px solid #7a2d3a',
  background: 'transparent', color: '#ffc5d0', cursor: 'pointer', fontSize: '0.75rem',
}
