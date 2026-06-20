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
import { topNeighbors } from '../lib/similarity'

const FAN_PAGE = 5 // neighbors revealed per "show more"

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
  const [fanLimit, setFanLimit] = useState(FAN_PAGE)
  const toastTimerRef = useRef(null)
  const queueRef = useRef(null)
  const dismissedRef = useRef(new Set()) // ids rejected during the open fan

  const storeNodes = useBoardStore(s => s.nodes)
  const storeEdges = useBoardStore(s => s.edges)
  const ghosts = useBoardStore(s => s.ghosts)
  const expandedFrom = useBoardStore(s => s.expandedFrom)
  const addImageNode = useBoardStore(s => s.addImageNode)
  const setNodeRefs = useBoardStore(s => s.setNodeRefs)
  const setNodePos = useBoardStore(s => s.setNodePos)
  const setGhosts = useBoardStore(s => s.setGhosts)
  const clearGhosts = useBoardStore(s => s.clearGhosts)
  const addBranchEdge = useBoardStore(s => s.addBranchEdge)
  const loadBoardData = useBoardStore(s => s.loadBoardData)

  // ids already linked to `id` (either direction) — never suggested again.
  const connectedIds = useCallback((id) => {
    const s = new Set()
    useBoardStore.getState().edges.forEach(e => {
      if (e.source === id) s.add(e.target)
      if (e.target === id) s.add(e.source)
    })
    return s
  }, [])

  // top similar board nodes for `srcId`, minus already-linked and rejected ones.
  const neighborsFor = useCallback((srcId, limit) => {
    const nodes = useBoardStore.getState().nodes
    const src = nodes.find(n => n.id === srcId)
    if (!src || src.status !== 'ready' || !Array.isArray(src.embedding)) return []
    const excludeIds = new Set([...connectedIds(srcId), ...dismissedRef.current])
    return topNeighbors(src, nodes, { limit, excludeIds })
  }, [connectedIds])

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

  const toGhost = (n) => ({ id: n.id, thumbRef: n.thumbRef, score: n.score })

  // Pill click → open a fresh fan of the top similar nodes around the source.
  const handleExpand = useCallback((srcId) => {
    dismissedRef.current = new Set()
    setFanLimit(FAN_PAGE)
    setSelectedId(srcId)
    setGhosts(srcId, neighborsFor(srcId, FAN_PAGE).map(toGhost))
  }, [neighborsFor, setGhosts])

  // ✓ accept → draw the provenance edge, drop the ghost from the fan.
  const acceptGhost = useCallback((srcId, ghostId) => {
    addBranchEdge(srcId, ghostId)
    setGhosts(srcId, useBoardStore.getState().ghosts.filter(g => g.id !== ghostId))
  }, [addBranchEdge, setGhosts])

  // ✕ reject → remember the dismissal so "show more" won't resurface it.
  const rejectGhost = useCallback((srcId, ghostId) => {
    dismissedRef.current.add(ghostId)
    setGhosts(srcId, useBoardStore.getState().ghosts.filter(g => g.id !== ghostId))
  }, [setGhosts])

  const showMore = useCallback((srcId) => {
    const next = fanLimit + FAN_PAGE
    setFanLimit(next)
    setGhosts(srcId, neighborsFor(srcId, next).map(toGhost))
  }, [fanLimit, neighborsFor, setGhosts])

  const clearFan = useCallback(() => {
    dismissedRef.current = new Set()
    setFanLimit(FAN_PAGE)
    clearGhosts()
  }, [clearGhosts])

  // Esc clears an open fan, else deselects.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (useBoardStore.getState().expandedFrom) clearFan()
      else setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearFan])

  const T = zoomTransformRef.current
  const nodeById = Object.fromEntries(storeNodes.map(n => [n.id, n]))
  const ghostIdSet = new Set(ghosts.map(g => g.id))
  const pillCount = (selectedId && !expandedFrom) ? neighborsFor(selectedId, FAN_PAGE).length : 0
  const fanSrc = expandedFrom ? simNodesRef.current.find(n => n.id === expandedFrom) : null

  return (
    <ImportDropzone onFiles={importFiles}>
      <svg ref={svgRef} style={{ width: '100%', height: '100%', background: '#0c0c1a', display: 'block' }}
        onClick={() => { clearFan(); setSelectedId(null) }}>
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
            // While a fan is open, dim the real nodes shown as ghosts (avoid dupes).
            const isGhosted = expandedFrom && ghostIdSet.has(sn.id)
            return <ImageNode key={sn.id} node={data} x={sn.x} y={sn.y}
              isSelected={selectedId === sn.id} dimmed={isGhosted}
              pillCount={selectedId === sn.id ? pillCount : 0}
              onMouseDown={handleNodeMouseDown} onExpand={handleExpand} />
          })}
          {fanSrc && fanSrc.x != null && ghosts.map((g, i) => {
            const ang = (2 * Math.PI * i) / ghosts.length - Math.PI / 2
            const r = NODE_R * 3.4
            const gx = fanSrc.x + r * Math.cos(ang)
            const gy = fanSrc.y + r * Math.sin(ang)
            return (
              <GhostNode key={g.id} ghost={g} x={gx} y={gy} sx={fanSrc.x} sy={fanSrc.y}
                onAccept={() => acceptGhost(expandedFrom, g.id)}
                onReject={() => rejectGhost(expandedFrom, g.id)} />
            )
          })}
          {fanSrc && fanSrc.x != null && ghosts.length > 0 && (
            <g transform={`translate(${fanSrc.x},${fanSrc.y + NODE_R * 3.4 + NODE_R + 22})`}
              style={{ cursor: 'pointer' }}
              onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}
              onClick={e => { e.stopPropagation(); showMore(expandedFrom) }}>
              <rect x={-44} y={-11} width={88} height={22} rx={11} fill="#16213e" stroke="#2d3a6a" />
              <text textAnchor="middle" dominantBaseline="central" fontSize={11} fill="#c5d0ff"
                style={{ userSelect: 'none' }}>show more</text>
            </g>
          )}
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

// A translucent suggestion floated around the source, with inline ✓/✕.
function GhostNode({ ghost, x, y, sx, sy, onAccept, onReject }) {
  const SIZE = NODE_R * 2
  const ref = ghost.thumbRef
  const src = ref ? (/^https?:|^blob:|^data:/.test(ref) ? ref : publicUrl(ref)) : null
  const clipId = `gclip-${ghost.id}`
  const stop = e => { e.stopPropagation(); e.preventDefault() }
  return (
    <g>
      <line x1={sx} y1={sy} x2={x} y2={y} stroke="#5b6af0" strokeWidth={1.5}
        strokeDasharray="4 4" opacity={0.6} />
      <g transform={`translate(${x - NODE_R},${y - NODE_R})`} opacity={0.92}>
        <clipPath id={clipId}><rect width={SIZE} height={SIZE} rx={10} ry={10} /></clipPath>
        <rect width={SIZE} height={SIZE} rx={10} ry={10} fill="#1a1a2e" />
        {src && <image href={src} width={SIZE} height={SIZE}
          preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId})`} />}
        <rect width={SIZE} height={SIZE} rx={10} ry={10} fill="none"
          stroke="#5b6af0" strokeWidth={1.5} strokeDasharray="5 4" />
        <g transform={`translate(${NODE_R - 16},${SIZE - 13})`} style={{ cursor: 'pointer' }}
          onMouseDown={stop} onClick={e => { stop(e); onAccept() }}>
          <circle r={12} fill="#1f7a4d" stroke="#0c0c1a" strokeWidth={1.5} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={13} fill="#fff"
            style={{ userSelect: 'none' }}>✓</text>
        </g>
        <g transform={`translate(${NODE_R + 16},${SIZE - 13})`} style={{ cursor: 'pointer' }}
          onMouseDown={stop} onClick={e => { stop(e); onReject() }}>
          <circle r={12} fill="#7a2d3a" stroke="#0c0c1a" strokeWidth={1.5} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={12} fill="#fff"
            style={{ userSelect: 'none' }}>✕</text>
        </g>
      </g>
    </g>
  )
}
