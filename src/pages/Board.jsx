/* eslint-disable react-hooks/refs -- D3↔React pattern: live sim positions live in
   mutable refs (simNodesRef/simEdgesRef/zoomTransformRef) and are read during render;
   re-renders are driven by the rAF-throttled setTick. This is the documented integration. */
import { useCallback, useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import useBoardStore, { NODE_R } from '../lib/boardStore'
import ImageNode from '../components/ImageNode'
import ImportDropzone from '../components/ImportDropzone'
import { hashBytes, downscaleImage, makeThumbnail } from '../lib/imageUtils'
import { uploadImage, publicUrl, loadBoard, saveBoard } from '../lib/db'
import { supabase } from '../lib/supabase'
import { embedImage, onEmbedderState } from '../lib/embedder'
import { createEmbedQueue } from '../lib/embedQueue'
import { searchVisual, proxiedImageUrl } from '../lib/discover'
import { classifyOrient, classifyMood, selectCandidates } from '../lib/criteria'

const FAN_PAGE = 5 // suggestions revealed per "show more"

// Reverse-image discovery runs through a Supabase Edge Function (hides the
// SerpAPI key + provides CORS). Available whenever Supabase is configured.
const FUNCTION_URL = import.meta.env.VITE_SUPABASE_URL
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/discover`
  : null
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

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
  const fanLimitRef = useRef(FAN_PAGE); fanLimitRef.current = fanLimit
  const [discovering, setDiscovering] = useState(false)
  const discoveringRef = useRef(false); discoveringRef.current = discovering
  const [criteria, setCriteria] = useState({ similarity: 'balanced', orient: 'any', mood: 'any' })
  const criteriaRef = useRef(criteria); criteriaRef.current = criteria
  const [, setSpinnerTick] = useState(0)     // drives slot-machine re-renders
  const spinnerSlotsRef = useRef([])         // current deck image per spinner slot
  const toastTimerRef = useRef(null)
  const queueRef = useRef(null)
  const dismissedRef = useRef(new Set()) // ids removed (rejected/accepted) during the open fan
  const rankedRef = useRef([])           // full ranked candidate list for the open discovery fan
  const boardIdRef = useRef(boardId); boardIdRef.current = boardId
  const loadedRef = useRef(false)        // gate autosave until the board has loaded
  const saveTimerRef = useRef(null)

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
  const setTags = useBoardStore(s => s.setTags)
  const loadBoardData = useBoardStore(s => s.loadBoardData)
  const [tagInput, setTagInput] = useState('')

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

  // Import core (shared by drag-drop files and accepted discovery photos):
  // hash-dedup → downscale + thumb → computing node → upload → refs → enqueue
  // for embedding (flips computing → ready). Returns the new node id, or null.
  const importBlob = useCallback(async (blob) => {
    const hash = await hashBytes(await blob.arrayBuffer())
    if (useBoardStore.getState().nodes.some(n => n.hash === hash)) {
      showToast('Skipped a duplicate image'); return null
    }
    const { blob: fullBlob, w, h } = await downscaleImage(blob)
    const thumbBlob = await makeThumbnail(blob)
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
    return nodeId
  }, [boardId, addImageNode, setNodeRefs, showToast])

  const importFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'))
    for (const file of files) {
      try { await importBlob(file) } catch { showToast('Could not read an image') }
    }
  }, [importBlob, showToast])

  // Download an accepted match into the board — via the proxy (CORS-safe).
  const importFromUrl = useCallback(async (url) => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(proxiedImageUrl(FUNCTION_URL, url), {
      headers: { Authorization: `Bearer ${session?.access_token}`, apikey: ANON_KEY },
    })
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    return importBlob(await res.blob())
  }, [importBlob])

  // Reflect the shared CLIP-model load state in a status chip.
  useEffect(() => onEmbedderState(setEmbedderStatus), [])

  // On model-load failure: re-enqueue every node that never reached `ready`,
  // resolving its uploaded image back to a URL the embedder can read.
  const retryEmbeddings = useCallback(() => {
    useBoardStore.getState().nodes
      .filter(n => n.status !== 'ready' && n.imageRef)
      .forEach(n => queueRef.current.enqueue(n.id, publicUrl(n.imageRef)))
  }, [])

  // Snapshot the doc with live sim positions folded in, and persist it.
  const persist = useCallback(() => {
    if (!loadedRef.current) return
    const { nodes, edges } = useBoardStore.getState()
    const posById = Object.fromEntries(simNodesRef.current.map(n => [n.id, n]))
    const out = nodes.map(n => ({ ...n, x: posById[n.id]?.x ?? n.x, y: posById[n.id]?.y ?? n.y }))
    saveBoard(boardIdRef.current, { nodes: out, edges }).catch(() => {})
  }, [])

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(persist, 1500)
  }, [persist])

  // Load the board on open; resume embedding for anything that never finished.
  useEffect(() => {
    loadedRef.current = false
    let cancelled = false
    loadBoard(boardId)
      .then(row => {
        if (cancelled) return
        loadBoardData({ nodes: row.nodes || [], edges: row.edges || [] })
        useBoardStore.getState().nodes
          .filter(n => !Array.isArray(n.embedding) && n.imageRef)
          .forEach(n => queueRef.current.enqueue(n.id, publicUrl(n.imageRef)))
      })
      .catch(() => { if (!cancelled) loadBoardData({ nodes: [], edges: [] }) })
      .finally(() => { if (!cancelled) loadedRef.current = true })
    return () => { cancelled = true }
  }, [boardId, loadBoardData])

  // Debounced autosave: persist whenever the document topology changes.
  useEffect(() => {
    const unsub = useBoardStore.subscribe((state, prev) => {
      if (state.nodes !== prev.nodes || state.edges !== prev.edges) scheduleSave()
    })
    return () => { unsub(); clearTimeout(saveTimerRef.current) }
  }, [scheduleSave])

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
        x: p?.x ?? n.x ?? cx + (Math.random() - 0.5) * 120,
        y: p?.y ?? n.y ?? cy + (Math.random() - 0.5) * 120,
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
        // gentle pull to centre → unanchored nodes self-arrange into a cloud;
        // dragged (fx/fy) nodes ignore these and stay put.
        .force('x', d3.forceX(cx).strength(0.035))
        .force('y', d3.forceY(cy).strength(0.035))
        .alphaDecay(0.04).velocityDecay(0.5).alphaMin(0.005)
        .on('tick', scheduleRender)
        .on('end', scheduleSave) // persist the settled layout
    } else {
      simRef.current.nodes(simNodesRef.current)
        .force('link', d3.forceLink(simEdgesRef.current).id(d => d.id).distance(120).strength(0.4))
        .alpha(0.5).restart()
    }
    scheduleRender()
  }, [storeNodes, storeEdges, scheduleRender, scheduleSave])

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

  const toGhost = (c) => ({ id: c.id, thumbRef: c.thumbUrl, url: c.url, score: c.score })

  // Candidates still in play: top-N by similarity, minus dismissed/filtered.
  const visibleRanked = useCallback(
    () => selectCandidates(rankedRef.current, dismissedRef.current, criteriaRef.current), [])

  // Recompute the visible fan from the ranked candidate list, honouring
  // dismissals, the criteria filter, and the current reveal limit.
  const renderFan = useCallback((srcId, limit) => {
    setGhosts(srcId, visibleRanked().slice(0, limit).map(toGhost))
  }, [setGhosts, visibleRanked])

  // ✦ click → reverse-image search: send THIS image to Google Lens (via the
  // proxy), fan out visually-similar new images. No query, no typing.
  const handleExpand = useCallback(async (srcId) => {
    if (!FUNCTION_URL) { showToast('Discovery backend not configured'); return }
    if (discoveringRef.current) return
    const src = useBoardStore.getState().nodes.find(n => n.id === srcId)
    if (!src) return
    if (!src.imageRef) { showToast('Image is still uploading…'); return }
    setSelectedId(srcId)
    clearGhosts()
    setDiscovering(true) // starts the slot-machine decoration
    dismissedRef.current = new Set()
    rankedRef.current = []
    setFanLimit(FAN_PAGE)
    try {
      const imageUrl = publicUrl(src.imageRef)
      const { data: { session } } = await supabase.auth.getSession()
      console.log('[discover] reverse-image search for', imageUrl)
      const matches = await searchVisual({
        functionUrl: FUNCTION_URL, token: session?.access_token, anonKey: ANON_KEY, imageUrl,
      })
      console.log('[discover] matches', matches.length)
      if (!matches.length) { showToast('No visual matches found'); return }
      rankedRef.current = matches
      // Measure shape + colour so the criteria filters mean something. Runs
      // while the slot-machine keeps spinning, then we reveal the real fan.
      await analyzeMatches(matches)
      console.log('[discover] analysed', matches.length)
      renderFan(srcId, FAN_PAGE)
      showToast(`Found ${matches.length} visually similar`)
    } catch (e) {
      console.error('[discover] failed', e)
      showToast('Discovery failed: ' + (e?.message || 'network'))
    } finally {
      setDiscovering(false)
    }
  }, [showToast, renderFan, clearGhosts])

  // Import a set of ghosts into the board (each gets a provenance edge),
  // dismiss the whole batch, then reveal the next page. Shared by every
  // "keep" action below.
  const keepGhosts = useCallback(async (srcId, toKeep, alsoDismiss = []) => {
    [...toKeep, ...alsoDismiss].forEach(g => dismissedRef.current.add(g.id))
    setGhosts(srcId, [])
    let kept = 0
    for (const g of toKeep) {
      if (!g.url) continue
      try {
        const newId = await importFromUrl(g.url)
        if (newId) { addBranchEdge(srcId, newId); kept++ }
      } catch { /* skip the ones that fail to download */ }
    }
    renderFan(srcId, fanLimitRef.current)
    return kept
  }, [setGhosts, importFromUrl, addBranchEdge, renderFan])

  // ✓ keep just this one.
  const acceptGhost = useCallback(async (srcId, ghostId) => {
    const ghost = useBoardStore.getState().ghosts.find(g => g.id === ghostId)
    if (await keepGhosts(srcId, ghost ? [ghost] : []) === 0) showToast('Could not add that image')
  }, [keepGhosts, showToast])

  // ✕ skip just this one (dismiss without keeping).
  const rejectGhost = useCallback((srcId, ghostId) => {
    dismissedRef.current.add(ghostId)
    setGhosts(srcId, useBoardStore.getState().ghosts.filter(g => g.id !== ghostId))
  }, [setGhosts])

  // Keep all currently-shown ghosts (mother-node action).
  const acceptAll = useCallback(async (srcId) => {
    const current = useBoardStore.getState().ghosts.slice()
    if (!current.length) return
    const kept = await keepGhosts(srcId, current)
    showToast(`Kept ${kept} image${kept === 1 ? '' : 's'}`)
  }, [keepGhosts, showToast])

  // Keep all currently-shown ghosts except this one (per-ghost action).
  const acceptAllBut = useCallback(async (srcId, ghostId) => {
    const current = useBoardStore.getState().ghosts.slice()
    const keep = current.filter(g => g.id !== ghostId)
    const skip = current.filter(g => g.id === ghostId)
    const kept = await keepGhosts(srcId, keep, skip)
    showToast(`Kept ${kept}, skipped 1`)
  }, [keepGhosts, showToast])

  // Keep none: dismiss everything shown, reveal the next page (mother-node).
  const keepNone = useCallback((srcId) => {
    useBoardStore.getState().ghosts.forEach(g => dismissedRef.current.add(g.id))
    renderFan(srcId, fanLimitRef.current)
  }, [renderFan])

  const showMore = useCallback((srcId) => {
    const next = fanLimit + FAN_PAGE
    setFanLimit(next)
    renderFan(srcId, next)
  }, [fanLimit, renderFan])

  // Change a criteria axis and re-filter an open fan immediately.
  const updateCriteria = useCallback((patch) => {
    const next = { ...criteriaRef.current, ...patch }
    criteriaRef.current = next
    setCriteria(next)
    const ef = useBoardStore.getState().expandedFrom
    if (ef) renderFan(ef, fanLimitRef.current)
  }, [renderFan])

  const clearFan = useCallback(() => {
    dismissedRef.current = new Set()
    rankedRef.current = []
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

  // Slot-machine decoration: while discovering, the fan slots flash through a
  // deck of already-loaded board thumbnails, slowing down as the real results
  // approach — then snap to the actual matches when discovery resolves.
  useEffect(() => {
    if (!discovering) { spinnerSlotsRef.current = []; return }
    const deck = useBoardStore.getState().nodes
      .map(n => n.thumbRef).filter(Boolean).map(publicUrl)
    deck.forEach(u => { const im = new Image(); im.src = u }) // warm the cache
    const pick = () => (deck.length ? deck[Math.floor(Math.random() * deck.length)] : null)
    spinnerSlotsRef.current = Array.from({ length: FAN_PAGE }, pick)
    let alive = true, delay = 55, timer
    const tick = () => {
      if (!alive) return
      spinnerSlotsRef.current = Array.from({ length: FAN_PAGE }, pick)
      setSpinnerTick(t => t + 1)
      delay = Math.min(440, delay * 1.10) // ease toward a stop
      timer = setTimeout(tick, delay)
    }
    timer = setTimeout(tick, delay)
    return () => { alive = false; clearTimeout(timer) }
  }, [discovering])

  const T = zoomTransformRef.current
  const nodeById = Object.fromEntries(storeNodes.map(n => [n.id, n]))
  const ghostIdSet = new Set(ghosts.map(g => g.id))
  const fanSrc = expandedFrom ? simNodesRef.current.find(n => n.id === expandedFrom) : null
  const selectedNode = selectedId ? nodeById[selectedId] : null
  const canDiscover = !!FUNCTION_URL && !expandedFrom && !!selectedNode && !!selectedNode.imageRef
  const moreCount = Math.max(0, visibleRanked().length - ghosts.length)
  // Source node for the slot-machine while a search is in flight.
  const spinSrc = discovering ? simNodesRef.current.find(n => n.id === selectedId) : null
  const showCriteria = !!selectedNode && (canDiscover || !!expandedFrom || discovering)

  const commitTag = () => {
    const t = tagInput.trim().replace(/,+$/, '').trim()
    setTagInput('')
    if (!t || !selectedNode) return
    const cur = selectedNode.tags || []
    if (!cur.includes(t)) setTags(selectedId, [...cur, t])
  }
  const removeTag = (t) => setTags(selectedId, (selectedNode.tags || []).filter(x => x !== t))

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
            // Every ready image carries its own ✦ "generate more" icon.
            const nodeCanDiscover = !!FUNCTION_URL && !!data.imageRef && !expandedFrom && !discovering
            return <ImageNode key={sn.id} node={data} x={sn.x} y={sn.y}
              isSelected={selectedId === sn.id} dimmed={isGhosted}
              canDiscover={nodeCanDiscover}
              onMouseDown={handleNodeMouseDown} onExpand={handleExpand} />
          })}
          {spinSrc && spinSrc.x != null && Array.from({ length: FAN_PAGE }).map((_, i) => {
            const ang = (2 * Math.PI * i) / FAN_PAGE - Math.PI / 2
            const r = NODE_R * 3.4
            const gx = spinSrc.x + r * Math.cos(ang)
            const gy = spinSrc.y + r * Math.sin(ang)
            return <SpinnerSlot key={i} src={spinnerSlotsRef.current[i]} x={gx} y={gy}
              sx={spinSrc.x} sy={spinSrc.y} />
          })}
          {fanSrc && fanSrc.x != null && ghosts.map((g, i) => {
            const ang = (2 * Math.PI * i) / ghosts.length - Math.PI / 2
            const r = NODE_R * 3.4
            const gx = fanSrc.x + r * Math.cos(ang)
            const gy = fanSrc.y + r * Math.sin(ang)
            return (
              <GhostNode key={g.id} ghost={g} x={gx} y={gy} sx={fanSrc.x} sy={fanSrc.y}
                onKeepThis={() => acceptGhost(expandedFrom, g.id)}
                onKeepRest={() => acceptAllBut(expandedFrom, g.id)}
                onSkip={() => rejectGhost(expandedFrom, g.id)} />
            )
          })}
          {/* Mother-node bulk controls: keep all / keep none, just above the source. */}
          {fanSrc && fanSrc.x != null && ghosts.length > 0 && (
            <g transform={`translate(${fanSrc.x},${fanSrc.y - NODE_R - 14})`}>
              <g style={{ cursor: 'pointer' }} transform="translate(-46,0)"
                onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}
                onClick={e => { e.stopPropagation(); acceptAll(expandedFrom) }}>
                <rect x={-42} y={-11} width={84} height={22} rx={11} fill="#1f7a4d" stroke="#0c0c1a" />
                <text textAnchor="middle" dominantBaseline="central" fontSize={11} fill="#fff"
                  style={{ userSelect: 'none' }}>✓ keep all {ghosts.length}</text>
              </g>
              <g style={{ cursor: 'pointer' }} transform="translate(46,0)"
                onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}
                onClick={e => { e.stopPropagation(); keepNone(expandedFrom) }}>
                <rect x={-42} y={-11} width={84} height={22} rx={11} fill="#3a1f2a" stroke="#7a2d3a" />
                <text textAnchor="middle" dominantBaseline="central" fontSize={11} fill="#ffc5d0"
                  style={{ userSelect: 'none' }}>✕ keep none</text>
              </g>
            </g>
          )}
          {fanSrc && fanSrc.x != null && ghosts.length > 0 && moreCount > 0 && (
            <g transform={`translate(${fanSrc.x},${fanSrc.y + NODE_R * 3.4 + NODE_R + 22})`}
              style={{ cursor: 'pointer' }}
              onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}
              onClick={e => { e.stopPropagation(); showMore(expandedFrom) }}>
              <rect x={-52} y={-11} width={104} height={22} rx={11} fill="#16213e" stroke="#2d3a6a" />
              <text textAnchor="middle" dominantBaseline="central" fontSize={11} fill="#c5d0ff"
                style={{ userSelect: 'none' }}>show {moreCount} more</text>
            </g>
          )}
        </g>
      </svg>
      {embedderStatus === 'loading' && (
        <div style={chipStyle}>loading similarity model…</div>
      )}
      {discovering && (
        <div style={{ ...chipStyle, top: 48 }}>✦ finding visually similar images…</div>
      )}
      {showCriteria && (
        <div style={criteriaPanel}>
          <div style={criteriaTitle}>✦ tune results</div>
          <CriteriaRow label="match" value={criteria.similarity} onPick={v => updateCriteria({ similarity: v })}
            options={[['strict', 'Strict'], ['balanced', 'Balanced'], ['loose', 'Loose']]} />
          <CriteriaRow label="shape" value={criteria.orient} onPick={v => updateCriteria({ orient: v })}
            options={[['any', 'Any'], ['wide', '▭ Wide'], ['tall', '▯ Tall'], ['square', '◻ Square']]} />
          <CriteriaRow label="colour" value={criteria.mood} onPick={v => updateCriteria({ mood: v })}
            options={[['any', 'Any'], ['warm', '🔥 Warm'], ['cool', '❄ Cool'], ['mono', '◐ Mono']]} />
        </div>
      )}
      {embedderStatus === 'error' && (
        <div style={{ ...chipStyle, borderColor: '#7a2d3a', color: '#ffc5d0' }}>
          similarity model failed
          <button style={retryBtn} onClick={retryEmbeddings}>retry</button>
        </div>
      )}
      {selectedNode && (
        <div style={tagPanel}>
          <span style={{ color: '#8090b8', fontSize: '0.72rem' }}>tags</span>
          {(selectedNode.tags || []).map(t => (
            <span key={t} style={tagChip}>
              {t}
              <span style={tagX} onClick={() => removeTag(t)}>✕</span>
            </span>
          ))}
          <input
            style={tagInputStyle}
            value={tagInput}
            placeholder="add tag…"
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); e.stopPropagation(); commitTag() }
            }}
          />
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

const tagPanel = {
  position: 'absolute', bottom: 16, left: 16, zIndex: 30,
  display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', maxWidth: 360,
  padding: '0.45rem 0.6rem', borderRadius: 8, background: '#111118', border: '1px solid #2d3a6a',
}

const tagChip = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '0.1rem 0.45rem', borderRadius: 12, background: '#1f2a4d',
  color: '#c5d0ff', fontSize: '0.74rem',
}

const tagX = { cursor: 'pointer', color: '#8090b8', fontSize: '0.66rem' }

const tagInputStyle = {
  width: 90, padding: '0.2rem 0.4rem', borderRadius: 6, border: '1px solid #2d3a6a',
  background: '#0c0c1a', color: '#c5d0ff', fontSize: '0.74rem', outline: 'none',
}

const criteriaPanel = {
  position: 'absolute', top: 12, left: 12, zIndex: 30,
  display: 'flex', flexDirection: 'column', gap: 6,
  padding: '0.5rem 0.6rem', borderRadius: 10, background: '#111118', border: '1px solid #2d3a6a',
  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
}
const criteriaTitle = { color: '#8090b8', fontSize: '0.72rem', fontWeight: 600 }
const criteriaRowStyle = { display: 'flex', alignItems: 'center', gap: 4 }
const criteriaLabel = { color: '#7080a0', fontSize: '0.66rem', width: 42 }
const segBtn = (active) => ({
  padding: '0.12rem 0.4rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.68rem',
  border: `1px solid ${active ? '#5b6af0' : '#2d3a6a'}`,
  background: active ? '#1f2a4d' : 'transparent', color: active ? '#c5d0ff' : '#8090b8',
})

function CriteriaRow({ label, value, onPick, options }) {
  return (
    <div style={criteriaRowStyle}>
      <span style={criteriaLabel}>{label}</span>
      {options.map(([v, lbl]) => (
        <span key={v} style={segBtn(value === v)} onClick={() => onPick(v)}>{lbl}</span>
      ))}
    </div>
  )
}

// One slot-machine cell: a flashing preloaded thumbnail while a search runs.
function SpinnerSlot({ src, x, y, sx, sy }) {
  const SIZE = NODE_R * 2
  return (
    <g>
      <line x1={sx} y1={sy} x2={x} y2={y} stroke="#5b6af0" strokeWidth={1.5}
        strokeDasharray="3 5" opacity={0.4} />
      <g transform={`translate(${x - NODE_R},${y - NODE_R})`} opacity={0.85}>
        <rect width={SIZE} height={SIZE} rx={10} ry={10} fill="#161427" />
        {src && <image href={src} width={SIZE} height={SIZE} preserveAspectRatio="xMidYMid slice"
          opacity={0.65} />}
        <rect width={SIZE} height={SIZE} rx={10} ry={10} fill="none" stroke="#5b6af0"
          strokeWidth={1.5} strokeDasharray="6 5">
          <animate attributeName="stroke-dashoffset" from="0" to="22" dur="0.6s" repeatCount="indefinite" />
        </rect>
      </g>
    </g>
  )
}

// --- Candidate analysis (browser-only): measure shape + dominant colour so
// the criteria filters mean something. Every load is time-boxed so a slow or
// CORS-blocked thumbnail never stalls the reveal; failures just leave the
// attribute unknown (which never excludes a candidate).
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise(res => setTimeout(() => res(null), ms))])
}

function loadDims(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = reject
    img.src = url
  })
}

function loadAvgColor(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = 16; c.height = 16
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0, 16, 16)
        const { data } = ctx.getImageData(0, 0, 16, 16)
        let r = 0, g = 0, b = 0, n = 0
        for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++ }
        resolve({ r: r / n, g: g / n, b: b / n })
      } catch (e) { reject(e) }
    }
    img.onerror = reject
    img.src = url
  })
}

async function analyzeMatches(matches) {
  await Promise.all(matches.map(async (m) => {
    const dims = await withTimeout(loadDims(m.thumbUrl).catch(() => null), 4000)
    if (dims) m.orient = classifyOrient(dims.w, dims.h)
    const col = await withTimeout(
      loadAvgColor(proxiedImageUrl(FUNCTION_URL, m.thumbUrl, ANON_KEY)).catch(() => null), 4500)
    if (col) m.mood = classifyMood(col)
  }))
}

// A translucent suggestion floated around the source. Inline actions:
// ✓ keep just this one · "rest" keep all but this one · ✕ skip this one.
function GhostNode({ ghost, x, y, sx, sy, onKeepThis, onKeepRest, onSkip }) {
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
        {/* keep this one */}
        <g transform={`translate(${NODE_R - 26},${SIZE - 13})`} style={{ cursor: 'pointer' }}
          onMouseDown={stop} onClick={e => { stop(e); onKeepThis() }}>
          <title>Keep just this one</title>
          <circle r={12} fill="#1f7a4d" stroke="#0c0c1a" strokeWidth={1.5} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={13} fill="#fff"
            style={{ userSelect: 'none' }}>✓</text>
        </g>
        {/* keep all but this one */}
        <g transform={`translate(${NODE_R},${SIZE - 13})`} style={{ cursor: 'pointer' }}
          onMouseDown={stop} onClick={e => { stop(e); onKeepRest() }}>
          <title>Keep all but this one</title>
          <rect x={-20} y={-11} width={40} height={22} rx={11} fill="#243a6a" stroke="#0c0c1a" strokeWidth={1.5} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={9.5} fill="#c5d0ff"
            style={{ userSelect: 'none' }}>rest</text>
        </g>
        {/* skip this one */}
        <g transform={`translate(${NODE_R + 26},${SIZE - 13})`} style={{ cursor: 'pointer' }}
          onMouseDown={stop} onClick={e => { stop(e); onSkip() }}>
          <title>Skip this one</title>
          <circle r={12} fill="#7a2d3a" stroke="#0c0c1a" strokeWidth={1.5} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={12} fill="#fff"
            style={{ userSelect: 'none' }}>✕</text>
        </g>
      </g>
    </g>
  )
}
