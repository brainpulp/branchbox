/* eslint-disable react-hooks/refs -- D3↔React pattern: live sim positions live in
   mutable refs (simNodesRef/simEdgesRef/zoomTransformRef) and are read during render;
   re-renders are driven by the rAF-throttled setTick. This is the documented integration. */
import { useCallback, useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import useBoardStore, { NODE_R } from '../lib/boardStore'
import ImageNode from '../components/ImageNode'

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

  const storeNodes = useBoardStore(s => s.nodes)
  const storeEdges = useBoardStore(s => s.edges)
  const addImageNode = useBoardStore(s => s.addImageNode)
  const setNodePos = useBoardStore(s => s.setNodePos)
  const loadBoardData = useBoardStore(s => s.loadBoardData)

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

  // Temporary (removed in M5 when real import lands): drop a placeholder node.
  const addTestNode = () => {
    const seed = Math.floor(Math.random() * 1e6)
    const url = `https://picsum.photos/seed/${seed}/256`
    addImageNode({ imageRef: url, thumbRef: url, w: 256, h: 256, status: 'ready' })
  }

  const T = zoomTransformRef.current
  const nodeById = Object.fromEntries(storeNodes.map(n => [n.id, n]))

  return (
    <div style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
      <button style={testBtn} onClick={addTestNode}>＋ test node</button>
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
    </div>
  )
}

const testBtn = {
  position: 'absolute', top: 12, left: 12, zIndex: 10,
  padding: '0.4rem 0.8rem', borderRadius: 8, border: '1px dashed #2d3a6a',
  background: '#111118', color: '#5b6af0', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
}
