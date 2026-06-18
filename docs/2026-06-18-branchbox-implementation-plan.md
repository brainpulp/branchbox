# Branchbox v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Branchbox v1 — a force-directed graph app for importing an image collection and exploring it by expanding visually-similar neighbors, with the exploration path kept visible as provenance edges.

**Architecture:** Vite + React (no TypeScript) SPA. A lean D3 force-sim canvas (patterns extracted from PIM's `Graph.jsx`, not copied wholesale) renders image nodes. CLIP embeddings are computed in-browser via transformers.js (WebGPU/WASM) in an eager background queue. Similarity is brute-force cosine + a Jaccard tag nudge, all client-side. Persistence is one JSONB-blob row per board in PIM's existing Supabase project, with image bytes in a storage bucket.

**Tech Stack:** Vite 8, React 19, D3 7, Zustand 5, `@huggingface/transformers` (transformers.js v3, for WebGPU), `@supabase/supabase-js` 2, Vitest + jsdom + @testing-library/react, gh-pages.

**Source spec:** [`docs/2026-06-18-branchbox-spec.md`](2026-06-18-branchbox-spec.md). **Reference codebase:** PIM at `F:\code\pim` (read-only — do not modify).

---

## Conventions for every task

- **Commit after every task** with a `feat:`/`test:`/`chore:` message.
- **Device-sync rule (from CLAUDE.md):** at session end run `git add -A && git commit && git push`. No exceptions.
- Use @superpowers:test-driven-development for every task that has unit tests (M3 especially): write the failing test, run it red, implement minimal, run it green, commit.
- Canvas/UX/integration tasks that can't be meaningfully unit-tested end in a **manual verification checkpoint** (run `npm run dev`, observe, confirm) per the spec's testing decision.
- PIM is the pattern source. When a task says "mirror PIM's X", open the referenced file/lines, copy the *pattern*, adapt names (`pim_` → `bb_`, `project` → `board`, text node → image node).

---

## File Structure (target)

```
branchbox/
  index.html
  vite.config.js              # base: '/branchbox/', vitest config
  package.json
  .env.local                  # VITE_SUPABASE_URL / _ANON_KEY (PIM's project ikztpvxfgmhmrcwolwgx) — gitignored
  .env.example                # documents the two vars (committed)
  src/
    main.jsx                  # React root (mirror PIM)
    App.jsx                   # auth gate → Boards picker → Board canvas (mirror PIM App.jsx)
    index.css                 # global reset
    lib/
      supabase.js             # createClient (mirror PIM, 1:1)
      db.js                   # bb_boards CRUD + image/thumb upload (mirror PIM db.js)
      boardStore.js           # Zustand: nodes[]/edges[] + actions + ghost/expand transient state
      imageUtils.js           # PURE: hashBytes, downscaleImage, makeThumbnail
      similarity.js           # PURE: cosine, jaccardTagOverlap, scoreCandidates, topNeighbors
      embedder.js             # CLIP model singleton + embedImage(blob) + load-state events
      embedQueue.js           # eager background embedding queue
    pages/
      Boards.jsx              # board picker: create/open/rename/delete (mirror PIM Projects.jsx)
      Board.jsx               # the canvas page: D3 sim, import, expand UX (lean fork of Graph.jsx)
    components/
      Auth.jsx                # email+password (mirror PIM Auth.jsx, 1:1 minus branding)
      ImageNode.jsx           # one image node: thumbnail, +N pill, tags, accept/reject (ghost)
      ImportDropzone.jsx      # paste/drag/upload affordance
  src/lib/__tests__/
      imageUtils.test.js
      similarity.test.js
      boardStore.test.js
  docs/
      2026-06-18-branchbox-spec.md
      2026-06-18-branchbox-implementation-plan.md   # this file
  src/test/setup.js           # jsdom/RTL setup
```

Each file has one responsibility. `similarity.js` and `imageUtils.js` are pure (no React, no Supabase) so they're trivially unit-testable — this is where the real bug surface lives.

---

# Milestone M0 — Scaffold & app shell

**Outcome:** an empty Vite+React app that builds, runs, lints, runs an empty Vitest suite, and shows a "Branchbox" placeholder. Deployable skeleton.

### Task M0.1: Initialize the Vite project

**Files:** Create `package.json`, `vite.config.js`, `index.html`, `src/main.jsx`, `src/App.jsx`, `src/index.css`, `.gitignore` (already has `.superpowers/`).

- [ ] **Step 1:** Scaffold in the existing repo (it already has `.git`, `docs/`, `CLAUDE.md`). From `F:\code\branchbox`:

```bash
npm create vite@latest . -- --template react
# When prompted about non-empty dir, choose "Ignore files and continue"
```

- [ ] **Step 2:** Pin/align deps to PIM's versions and add Branchbox-specific ones:

```bash
npm install d3@^7.9.0 zustand@^5 @supabase/supabase-js@^2 @huggingface/transformers@^3
npm install -D vitest@^2 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event gh-pages
```

- [ ] **Step 3:** Set `vite.config.js` (base path + vitest):

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/branchbox/',
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
  },
})
```

- [ ] **Step 4:** Create `src/test/setup.js`:

```js
import '@testing-library/jest-dom'
```

- [ ] **Step 5:** Add scripts to `package.json` (mirror PIM + test):

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "deploy": "vite build && gh-pages -d dist"
}
```

- [ ] **Step 6:** Replace `src/App.jsx` with a placeholder `<div>Branchbox</div>`; strip Vite demo CSS.
- [ ] **Step 7:** Run `npm run dev`, confirm "Branchbox" renders at the printed localhost URL. Run `npm run build` and `npm test` (empty pass).
- [ ] **Step 8: Commit** — `chore: scaffold vite+react+vitest skeleton`.

### Task M0.2: Verify a trivial test runs (TDD harness sanity)

**Files:** Create `src/lib/__tests__/sanity.test.js` (delete after).

- [ ] **Step 1:** Write `test('vitest works', () => expect(1 + 1).toBe(2))`.
- [ ] **Step 2:** Run `npm test` → PASS. Delete the file.
- [ ] **Step 3: Commit** — `test: confirm vitest harness`.

---

# Milestone M1 — Supabase backend + data layer

**Outcome:** `bb_boards` table + RLS + `branchbox-images` bucket exist in PIM's project; `db.js` can CRUD boards and upload images; auth works.

> Uses PIM's Supabase project `ikztpvxfgmhmrcwolwgx`. The agent has the Supabase MCP available (`mcp__cb4a7622-...__apply_migration`, `execute_sql`, etc.) — use it, or fall back to the Supabase dashboard SQL editor. **Confirm `list_tables` shows no existing `bb_boards` before creating.**

### Task M1.1: Create the `bb_boards` table, RLS, and bucket

**Files:** none in repo (DB migration). Record the SQL in `docs/2026-06-18-branchbox-db-setup.sql` for the record.

- [ ] **Step 1:** Apply this migration (Supabase MCP `apply_migration`, name `bb_boards_init`):

```sql
create table public.bb_boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Untitled',
  nodes jsonb not null default '[]'::jsonb,
  edges jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bb_boards enable row level security;

create policy "own boards: select" on public.bb_boards for select using (auth.uid() = user_id);
create policy "own boards: insert" on public.bb_boards for insert with check (auth.uid() = user_id);
create policy "own boards: update" on public.bb_boards for update using (auth.uid() = user_id);
create policy "own boards: delete" on public.bb_boards for delete using (auth.uid() = user_id);
```

- [ ] **Step 2:** Create a **public** storage bucket `branchbox-images` (dashboard → Storage → New bucket, public, ~10MB file limit), or via SQL `insert into storage.buckets (id, name, public) values ('branchbox-images','branchbox-images', true);`. Add storage RLS allowing authenticated users to upload to paths under their boards (mirror PIM's `pim-models` bucket policy — inspect it via `list` if unsure; for v1 a permissive "authenticated can insert/select" policy on the bucket is acceptable since it's a personal tool).
- [ ] **Step 3:** Verify with `list_tables` (see `bb_boards`) and a manual `insert`/`select`/`delete` round-trip via `execute_sql` using your own `auth.uid()`.
- [ ] **Step 4: Commit** the recorded `.sql` file — `chore: record bb_boards db setup`.

### Task M1.2: Supabase client + env

**Files:** Create `src/lib/supabase.js`, `.env.local` (gitignored), `.env.example`.

- [ ] **Step 1:** `src/lib/supabase.js` — copy PIM's `src/lib/supabase.js` verbatim (it's 6 lines, generic).
- [ ] **Step 2:** `.env.local` — set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to PIM's project `ikztpvxfgmhmrcwolwgx` values (get via Supabase MCP `get_project_url` + `get_publishable_keys`, or copy from `F:\code\pim\.env.local`). Confirm `.env.local` is gitignored.
- [ ] **Step 3:** `.env.example` — same keys with blank values + a comment. Commit this one.
- [ ] **Step 4: Commit** — `feat: supabase client + env`.

### Task M1.3: `db.js` — board CRUD + image upload

**Files:** Create `src/lib/db.js`. Pattern source: PIM `src/lib/db.js:1-91`.

- [ ] **Step 1:** Implement, mirroring PIM's helpers but for `bb_boards` (JSONB blob):

```js
import { supabase } from './supabase'

const tb = () => supabase.from('bb_boards')
const BUCKET = 'branchbox-images'

export async function listBoards() {
  const { data, error } = await tb()
    .select('id, name, updated_at')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createBoard(name = 'Untitled') {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await tb()
    .insert({ user_id: user.id, name, nodes: [], edges: [] })
    .select().single()
  if (error) throw error
  return data
}

export async function loadBoard(id) {
  const { data, error } = await tb().select('*').eq('id', id).single()
  if (error) throw error
  return data
}

export async function saveBoard(id, { nodes, edges }) {
  const { error } = await tb()
    .update({ nodes, edges, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function renameBoard(id, name) {
  const { error } = await tb().update({ name }).eq('id', id)
  if (error) throw error
}

export async function deleteBoard(id) {
  const { error } = await tb().delete().eq('id', id)
  if (error) throw error
}

// Upload an image Blob; returns the storage object path (NOT the URL)
export async function uploadImage(blob, boardId, nodeId, kind = 'full') {
  const suffix = kind === 'thumb' ? '.thumb.jpg' : '.jpg'
  const path = `${boardId}/${nodeId}${suffix}`
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
  if (error) throw error
  return path
}

// Resolve a stored object path to a public URL for rendering
export function publicUrl(path) {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}
```

- [ ] **Step 2:** (No unit test — thin Supabase wrapper; verified live in M1.4 / M7.) Run `npm run build` to typecheck-by-bundling.
- [ ] **Step 3: Commit** — `feat: bb_boards db layer`.

### Task M1.4: Auth + Boards picker + App shell

**Files:** Create `src/components/Auth.jsx`, `src/pages/Boards.jsx`, rewrite `src/App.jsx`, `src/main.jsx`, `src/index.css`. Pattern source: PIM `Auth.jsx` (1:1), `Projects.jsx` (rename project→board, `listProjects`→`listBoards`), `App.jsx:24-128` (drop the `table` view; keep auth gate + board open/close + localStorage `bb_last_board`).

- [ ] **Step 1:** `Auth.jsx` — copy PIM's, change title "PIM" → "Branchbox".
- [ ] **Step 2:** `Boards.jsx` — copy PIM's `Projects.jsx`, swap db imports to `listBoards/createBoard/renameBoard/deleteBoard`, "project"→"board".
- [ ] **Step 3:** `App.jsx` — copy PIM's auth-gate shape: `session === undefined` → Loading; `!session` → `<Auth/>`; `!board` → `<Boards/>`; else `<Board boardId=… boardName=… onBack=…/>`. Keep `AppErrorBoundary`. Use localStorage key `bb_last_board`. Remove the table/graph nav toggle (Branchbox has only the board view).
- [ ] **Step 4:** `main.jsx`/`index.css` — copy PIM's (generic).
- [ ] **Step 5:** Create a stub `src/pages/Board.jsx` that renders `<div>Board: {boardName}</div>` so the app compiles.
- [ ] **Step 6: Manual verification:** `npm run dev` → sign in with PIM creds → see Boards picker → create a board → open it → see the stub. Sign out works.
- [ ] **Step 7: Commit** — `feat: auth, boards picker, app shell`.

---

# Milestone M2 — Board store + lean D3 canvas (manual nodes)

**Outcome:** A board renders a working D3 force-directed canvas. You can add an image node from a local file (no embedding yet), it floats, you can drag-anchor it and draw provenance edges. This proves the canvas before the heavy pipeline lands.

### Task M2.1: `boardStore.js` (Zustand) — topology + transient expand state

**Files:** Create `src/lib/boardStore.js`, `src/lib/__tests__/boardStore.test.js`. Pattern source: PIM `graphStore.js:54-160` (node/edge ops), simplified (no views/slides/3D).

Use @superpowers:test-driven-development.

- [ ] **Step 1: Write failing tests** (`boardStore.test.js`):

```js
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

test('setTags replaces a node tag set', () => {
  const a = useBoardStore.getState().addImageNode({ imageRef: 'a', thumbRef: 'a', w: 1, h: 1 })
  useBoardStore.getState().setTags(a, ['red', 'chair'])
  expect(useBoardStore.getState().nodes[0].tags).toEqual(['red', 'chair'])
})

test('loadBoardData replaces topology', () => {
  useBoardStore.getState().loadBoardData({ nodes: [{ id: 'x', tags: [], embedding: null }], edges: [] })
  expect(useBoardStore.getState().nodes[0].id).toBe('x')
})
```

- [ ] **Step 2:** Run `npm test boardStore` → FAIL (module missing).
- [ ] **Step 3:** Implement `boardStore.js`:

```js
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
```

- [ ] **Step 4:** Run `npm test boardStore` → PASS.
- [ ] **Step 5: Commit** — `feat: board store with TDD`.

### Task M2.2: Lean D3 canvas in `Board.jsx`

**Files:** Rewrite `src/pages/Board.jsx`, create `src/components/ImageNode.jsx`. Pattern source: PIM `Graph.jsx` sim setup (lines ~534, 583-594) and the `simRef`/`simNodesRef`/`scheduleRender` integration described in PIM CLAUDE.md "D3 + React integration pattern".

This is canvas work — no unit test; ends in manual verification.

- [ ] **Step 1:** Build the sim scaffold in `Board.jsx`:
  - Refs: `svgRef`, `simRef`, `simNodesRef` (mutable array of `{id, x, y, fx, fy}`), `frameRef`.
  - `scheduleRender = useCallback(() => { if (frameRef.current) return; frameRef.current = requestAnimationFrame(() => { frameRef.current = null; setTick(t => t+1) }) }, [])`.
  - Effect keyed on `storeNodes`/`storeEdges`: reconcile `simNodesRef` (add new, keep positions of existing, drop removed), then:
    ```js
    simRef.current = d3.forceSimulation(simNodesRef.current)
      .force('link', d3.forceLink(simEdges).id(d => d.id).distance(120).strength(0.4))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('collide', d3.forceCollide(NODE_R + 8))
      .alphaDecay(0.04).velocityDecay(0.5).alphaMin(0.005).on('tick', scheduleRender)
    ```
  - Render `<svg>` with a pan/zoom `<g transform>` (d3.zoom), edges as `<line>`, nodes as `<ImageNode>` positioned at the live sim coords.
- [ ] **Step 2:** `ImageNode.jsx` — render a rounded-rect clip with the thumbnail (`<image href={publicUrl(thumbRef)}>`), sized to `NODE_R`. Props: node, isSelected, handlers. Drag the body → set `fx/fy` on the live sim node (anchor) and persist via `setNodePos`. Show a faint "computing…" overlay when `status==='computing'`.
- [ ] **Step 3:** Add a temporary "＋ test node" button that calls `addImageNode` with a placeholder image (e.g. an Unsplash URL stored as `imageRef`, status `ready`) so you can see nodes float and connect. (Removed in M5 when real import lands.)
- [ ] **Step 4: Manual verification:** `npm run dev` → open a board → click "＋ test node" a few times → nodes appear and force-spread → drag one → it anchors → reload page keeps positions (after M7 persistence; for now just in-session).
- [ ] **Step 5: Commit** — `feat: lean d3 image canvas`.

---

# Milestone M3 — Pure logic: image utils + similarity engine (TDD-heavy)

**Outcome:** Fully unit-tested pure functions for hashing, downscaling, thumbnailing, and the entire similarity/ranking engine. No UI. This is the core correctness surface.

### Task M3.1: `imageUtils.js` — hash, downscale, thumbnail

**Files:** Create `src/lib/imageUtils.js`, `src/lib/__tests__/imageUtils.test.js`. Use @superpowers:test-driven-development.

> `downscale`/`makeThumbnail` use `createImageBitmap` + `OffscreenCanvas` (available in jsdom? **No** — jsdom lacks canvas). So: unit-test `hashBytes` (pure, uses `crypto.subtle`) and the pure helper `fitDimensions(w,h,maxEdge)`; the canvas-touching `downscaleImage`/`makeThumbnail` are thin wrappers verified manually in M5. Keep the canvas-free math in `fitDimensions` so it IS tested.

- [ ] **Step 1: Write failing tests:**

```js
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
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement:

```js
export function fitDimensions(w, h, maxEdge) {
  const longest = Math.max(w, h)
  if (longest <= maxEdge) return { w, h }
  const k = maxEdge / longest
  return { w: Math.round(w * k), h: Math.round(h * k) }
}

export async function hashBytes(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// Canvas-touching (verified manually in M5): decode → downscale → JPEG blob
export async function downscaleImage(blob, maxEdge = 1600, quality = 0.85) {
  const bmp = await createImageBitmap(blob)
  const { w, h } = fitDimensions(bmp.width, bmp.height, maxEdge)
  const canvas = new OffscreenCanvas(w, h)
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality })
  return { blob: out, w, h }
}

export async function makeThumbnail(blob, maxEdge = 256, quality = 0.8) {
  return (await downscaleImage(blob, maxEdge, quality)).blob
}
```

- [ ] **Step 4:** Run → PASS. **Commit** — `feat: image utils (hash + fit dims) with TDD`.

### Task M3.2: `similarity.js` — cosine, tag overlap, scoring, top-N + dedup

**Files:** Create `src/lib/similarity.js`, `src/lib/__tests__/similarity.test.js`. Use @superpowers:test-driven-development. **This is the most important task in the plan** — the spec's hand-crafted-fixture-vector technique applies here.

- [ ] **Step 1: Write failing tests** (fixture vectors, deterministic):

```js
import { expect, test } from 'vitest'
import { cosine, jaccardTagOverlap, scoreCandidate, topNeighbors } from '../similarity'

test('cosine: identical→1, orthogonal→0, opposite→-1', () => {
  expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
  expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
  expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1)
})

test('cosine: zero vector → 0 (no NaN)', () => {
  expect(cosine([0, 0], [1, 1])).toBe(0)
})

test('jaccardTagOverlap: |∩|/|∪|, 0 when either empty', () => {
  expect(jaccardTagOverlap(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3)
  expect(jaccardTagOverlap(['a'], ['a'])).toBeCloseTo(1)
  expect(jaccardTagOverlap([], ['a'])).toBe(0)
  expect(jaccardTagOverlap([], [])).toBe(0)
})

test('scoreCandidate blends cosine + λ·tagOverlap', () => {
  const src = { embedding: [1, 0], tags: ['red'] }
  const cand = { embedding: [1, 0], tags: ['red'] }
  // cosine 1 + 0.15*1 = 1.15
  expect(scoreCandidate(src, cand, 0.15)).toBeCloseTo(1.15)
})

test('topNeighbors ranks by blended score, excludes self and excludeIds, respects limit', () => {
  const src = { id: 's', embedding: [1, 0], tags: ['red'] }
  const pool = [
    { id: 's', embedding: [1, 0], tags: ['red'] },        // self → excluded
    { id: 'a', embedding: [0.9, 0.1], tags: [] },          // high cosine
    { id: 'b', embedding: [0.2, 0.98], tags: ['red'] },    // low cosine, tag nudge
    { id: 'c', embedding: [0.8, 0.2], tags: [] },          // mid cosine
    { id: 'd', embedding: [1, 0], tags: ['red'] },         // ~tied top but excluded
  ]
  const out = topNeighbors(src, pool, { limit: 2, lambda: 0.15, excludeIds: new Set(['d']) })
  expect(out.map(n => n.id)).toEqual(['a', 'c'])
  expect(out[0].score).toBeGreaterThan(out[1].score)
})

test('topNeighbors skips candidates with no embedding', () => {
  const src = { id: 's', embedding: [1, 0], tags: [] }
  const pool = [{ id: 'a', embedding: null, tags: [] }, { id: 'b', embedding: [1, 0], tags: [] }]
  expect(topNeighbors(src, pool, { limit: 5 }).map(n => n.id)).toEqual(['b'])
})
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement:

```js
export const DEFAULT_LAMBDA = 0.15

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export function jaccardTagOverlap(t1, t2) {
  if (!t1?.length || !t2?.length) return 0
  const s1 = new Set(t1), s2 = new Set(t2)
  let inter = 0
  for (const t of s1) if (s2.has(t)) inter++
  const union = s1.size + s2.size - inter
  return union === 0 ? 0 : inter / union
}

export function scoreCandidate(src, cand, lambda = DEFAULT_LAMBDA) {
  return cosine(src.embedding, cand.embedding) + lambda * jaccardTagOverlap(src.tags, cand.tags)
}

export function topNeighbors(src, pool, { limit = 5, lambda = DEFAULT_LAMBDA, excludeIds = new Set() } = {}) {
  return pool
    .filter(n => n.id !== src.id && !excludeIds.has(n.id) && Array.isArray(n.embedding))
    .map(n => ({ ...n, score: scoreCandidate(src, n, lambda) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
```

- [ ] **Step 4:** Run → PASS (all green).
- [ ] **Step 5: Commit** — `feat: similarity engine (cosine + tag-blend + topN) with TDD`.

---

# Milestone M4 — In-browser embedding pipeline

**Outcome:** A CLIP model loads once (WebGPU→WASM), embeds an image Blob to a vector, and an eager queue drives per-node `computing → ready` transitions.

### Task M4.1: `embedder.js` — CLIP singleton + load states

**Files:** Create `src/lib/embedder.js`. Not unit-tested (downloads a 150MB model; mocked at the queue boundary instead). Manual verification.

- [ ] **Step 1:** Implement a lazy singleton over transformers.js image-feature-extraction:

```js
import { pipeline, env } from '@huggingface/transformers'

env.allowLocalModels = false   // fetch from HF CDN

let _pipe = null
let _loadState = 'idle'        // 'idle' | 'loading' | 'ready' | 'error'
const _listeners = new Set()
export const onEmbedderState = (fn) => { _listeners.add(fn); return () => _listeners.delete(fn) }
const _emit = (s) => { _loadState = s; _listeners.forEach(fn => fn(s)) }
export const embedderState = () => _loadState

export async function ensureEmbedder() {
  if (_pipe) return _pipe
  _emit('loading')
  try {
    // try WebGPU, fall back to wasm
    try {
      _pipe = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32', { device: 'webgpu' })
    } catch {
      _pipe = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32')
    }
    _emit('ready')
    return _pipe
  } catch (e) {
    _emit('error')
    throw e
  }
}

// blobUrl: an object URL for the (downscaled) image
export async function embedImage(blobUrl) {
  const pipe = await ensureEmbedder()
  const out = await pipe(blobUrl, { pooling: 'mean', normalize: true })
  return Array.from(out.data)   // plain JS number[] for JSONB
}
```

- [ ] **Step 2: Manual verification (throwaway):** temporarily call `embedImage` on a test image in `Board.jsx`, log the vector length (512) and that two similar images cosine-high. Remove the throwaway.
- [ ] **Step 3: Commit** — `feat: clip embedder singleton`.

### Task M4.2: `embedQueue.js` — eager, throttled, per-node status

**Files:** Create `src/lib/embedQueue.js`, `src/lib/__tests__/embedQueue.test.js`. Use @superpowers:test-driven-development with an **injected embed fn** (so no model download in tests).

- [ ] **Step 1: Write failing tests** (inject a fake embedder, assert order + callbacks):

```js
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
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement a minimal FIFO single-worker queue:

```js
export function createEmbedQueue({ embed, onReady, onError = () => {} }) {
  const jobs = []
  let running = false, drainResolvers = []

  async function run() {
    if (running) return
    running = true
    while (jobs.length) {
      const { id, url } = jobs.shift()
      try { onReady(id, await embed(url)) }
      catch (e) { onError(id, e) }
    }
    running = false
    drainResolvers.splice(0).forEach(r => r())
  }

  return {
    enqueue(id, url) { jobs.push({ id, url }); run() },
    drain() { return jobs.length || running ? new Promise(r => drainResolvers.push(r)) : Promise.resolve() },
  }
}
```

- [ ] **Step 4:** Run → PASS. **Commit** — `feat: embed queue with TDD`.

---

# Milestone M5 — Import flow

**Outcome:** Paste / drag-drop / file-pick adds real images: downscaled, thumbnailed, byte-hash-deduped, uploaded to the bucket, placed as `computing` nodes, then embedded via the queue → `ready`.

### Task M5.0: Store extension — `hash` field + `setNodeRefs` (TDD)

**Files:** `src/lib/boardStore.js`, `src/lib/__tests__/boardStore.test.js`. Use @superpowers:test-driven-development. (Pulled out of M5.1 so the store change gets its own red→green→commit cycle and isn't skipped under a manual-verification banner.)

- [ ] **Step 1: Write failing tests:**

```js
test('addImageNode stores a hash when provided', () => {
  const id = useBoardStore.getState().addImageNode({ imageRef: 'a', thumbRef: 'a', w: 1, h: 1, hash: 'deadbeef' })
  expect(useBoardStore.getState().nodes[0].hash).toBe('deadbeef')
})

test('setNodeRefs updates image/thumb paths', () => {
  const id = useBoardStore.getState().addImageNode({ imageRef: null, thumbRef: null, w: 1, h: 1 })
  useBoardStore.getState().setNodeRefs(id, 'b/n.jpg', 'b/n.thumb.jpg')
  expect(useBoardStore.getState().nodes[0]).toMatchObject({ imageRef: 'b/n.jpg', thumbRef: 'b/n.thumb.jpg' })
})
```

- [ ] **Step 2:** Run → FAIL. Add `hash` to `addImageNode`'s node object and a `setNodeRefs(id, imageRef, thumbRef)` action. Run → PASS.
- [ ] **Step 3: Commit** — `feat: store hash + node refs (TDD)`.

### Task M5.1: `ImportDropzone.jsx` + import handler

**Files:** Create `src/components/ImportDropzone.jsx`; add an `importFiles(fileList)` handler in `Board.jsx`. Canvas/integration — manual verification.

- [ ] **Step 1:** `importFiles(files)` pipeline per file:
  1. `arrayBuffer` → `hashBytes` → if hash already present on any board node (`node.hash`), skip with a toast.
  2. `downscaleImage(file)` → `{ blob, w, h }`; `makeThumbnail(file)` → thumb blob.
  3. `addImageNode({ ..., status: 'computing', hash })` → `nodeId`.
  4. `uploadImage(fullBlob, boardId, nodeId, 'full')` + `uploadImage(thumbBlob, boardId, nodeId, 'thumb')` → `setNodeRefs(nodeId, fullPath, thumbPath)`.
  5. `embedQueue.enqueue(nodeId, URL.createObjectURL(fullBlob))`; on ready → `setEmbedding`.
- [ ] **Step 2:** `ImportDropzone` — a drop target + hidden file input + paste listener (`window.addEventListener('paste', …)` reading `clipboardData.items`). Calls `importFiles`.
- [ ] **Step 3:** Remove the temporary "＋ test node" button from M2.
- [ ] **Step 4: Manual verification:** drag 3–4 images in → they appear as computing → flip to ready (thumbnails render) → drop a duplicate → toast + skipped. Check the bucket has the objects.
- [ ] **Step 5: Commit** — `feat: image import pipeline`.

### Task M5.2: Model load/error UX

**Files:** `Board.jsx`. Wire `onEmbedderState` → a small status chip ("loading similarity model…" / error + retry). Per spec Section 4.

- [ ] **Step 1:** Subscribe to `onEmbedderState`; show chip while `loading`; on `error` show a retry that re-enqueues un-embedded (`status!=='ready'`) nodes.
- [ ] **Step 2: Manual verification:** throttle network in devtools, reload, confirm the loading chip shows then clears; simulate failure (block the HF CDN) → error chip + retry works.
- [ ] **Step 3: Commit** — `feat: embedder load/error UX`.

---

# Milestone M6 — Expand / branch UX ("+N pill → fan")

**Outcome:** The core feature. Ready nodes show a "+N" pill; clicking fans out the top-5 similar images as ghost nodes; accept solidifies (real node + provenance edge), reject fades; "show more" loads the next 5; tags are editable.

### Task M6.1: Neighbor count + "+N" pill

**Files:** `ImageNode.jsx`, `Board.jsx`. Uses `topNeighbors` from M3.

- [ ] **Step 1:** For a `ready`, selected (or hovered) node, compute `topNeighbors(node, boardNodes, { limit: 5, excludeIds })` where `excludeIds` = already-connected/placed neighbor ids. Show a "+{count}" pill (hide if 0).
- [ ] **Step 2: Manual verification:** import ~6 images, select one → pill shows a plausible count.
- [ ] **Step 3: Commit** — `feat: neighbor pill`.

### Task M6.2: Fan-out ghosts + accept/reject + show more

**Files:** `Board.jsx`, `ImageNode.jsx`, `boardStore.js` (uses `ghosts`/`setGhosts`/`clearGhosts` from M2.1).

- [ ] **Step 1:** Click pill → `setGhosts(nodeId, topNeighbors(...).map(toGhost))`. Render ghosts as translucent `ImageNode`s positioned radially around the source (simple angular layout; they're transient, not in the sim). Each ghost has ✓/✕.
  - **UX note (from review):** since v1 suggestions are existing board nodes already placed by the sim, a ghost visually duplicates a node already on the canvas. While a fan is open, **dim or temporarily hide the real board nodes that are currently shown as ghosts** (match by id) so the user sees one representation, not two overlapping. Restore them on accept/reject/clear.
  - ✓ accept → the suggested node already exists in `boardNodes` (neighbors come from the board pool), so "accept" = `addBranchEdge(source, ghost.id)` + remove it from ghosts. (The future cross-board case — a suggestion not yet on the board — is the only one that would `addImageNode`.) Recompute the source's pill; the accepted node becomes branchable.
  - ✕ reject → remove from ghosts and remember the dismissal for this session so "show more" doesn't re-surface it: track a per-source `Set` of dismissed ids in component state.
- [ ] **Step 2:** "show more" → recompute `topNeighbors` with `limit: prev+5` and `excludeIds` ∪ accepted ∪ dismissed.
- [ ] **Step 3:** Click empty canvas / Esc → `clearGhosts` (and un-dim the real nodes).
- [ ] **Step 4: Store-level test (spec Section 8) — TDD.** In `boardStore.test.js`, add a test for the expand→clear path: `setGhosts('s', [{id:'g1'},{id:'g2'}])` sets `expandedFrom`/`ghosts`; `addBranchEdge('s','g1')` creates the edge; `clearGhosts()` empties `ghosts` and nulls `expandedFrom`. Run → PASS. (Closes the store-mutation loop the spec calls out; the visual accept/reject wiring stays in manual verification.)
- [ ] **Step 5: Manual verification:** select node → pill → fan (real duplicates dimmed) → accept two, reject one → edges drawn to accepted, canvas re-settles → "show more" reveals further candidates → branch again from an accepted node.
- [ ] **Step 6: Commit** — `feat: expand/branch fan UX`.

### Task M6.3: Tag editing

**Files:** `ImageNode.jsx` (or a small `TagEditor`). Uses `setTags` from M2.1.

- [ ] **Step 1:** On a selected node, a small tag input (comma/Enter to add, ✕ to remove chip) calling `setTags`. (Recompute pill afterward since tags nudge ranking.)
- [ ] **Step 2: Manual verification:** tag two unrelated images with a shared tag → confirm the tagged one ranks higher when expanding (visible re-order).
- [ ] **Step 3: Commit** — `feat: node tag editing`.

---

# Milestone M7 — Persistence, polish, deploy

**Outcome:** Boards save/load (JSONB), positions and embeddings survive reload, app is deployed to GitHub Pages, manual verification checklist passes.

### Task M7.1: Save/load wiring

**Files:** `Board.jsx`, `src/lib/db.js`.

- [ ] **Step 1:** On board open → `loadBoard(id)` → `loadBoardData({nodes, edges})`. Resolve `imageRef`/`thumbRef` paths to URLs via `publicUrl` at render time (don't store URLs).
- [ ] **Step 2:** Debounced autosave (e.g. 1.5s after the last change, mirroring how PIM saves): subscribe to store `nodes`/`edges` → `saveBoard(id, { nodes, edges })`. Persist `x/y` from the live sim into nodes before save (write sim positions back via `setNodePos` on drag-end / periodically).
- [ ] **Step 3:** Strip transient fields (`status`, `ghosts`) appropriately — `status` can persist as `ready`; ghosts are never in `nodes`.
- [ ] **Step 4: Manual verification:** import + arrange + branch → reload → identical board (positions, edges, thumbnails, tags). Open on a second board to confirm isolation.
- [ ] **Step 5: Commit** — `feat: board persistence`.

### Task M7.2: Manual verification checklist (spec Section 8)

**Files:** add `docs/verification-checklist.md`.

- [ ] **Step 1:** Write + run the checklist with ~8 known-similar fixture images (e.g. 4 chairs + 4 landscapes): import all → expand a chair → assert the other chairs rank above landscapes (subjective quality gate) → tag-nudge works → dedup works → reload persists → sign-out/in scopes to your user only.
- [ ] **Step 2:** Fix any issues found (loop back to the relevant milestone).
- [ ] **Step 3: Commit** — `docs: verification checklist + results`.

### Task M7.3: Deploy

- [ ] **Step 1:** Confirm `vite.config.js` `base: '/branchbox/'`. Run `npm run build` clean.
- [ ] **Step 2:** `npm run deploy` (gh-pages → `dist`). Enable GitHub Pages on the `gh-pages` branch if first time.
- [ ] **Step 3: Manual verification:** load `https://brainpulp.github.io/branchbox/`, sign in, full loop on the live site (per the user's verify-on-live-site rule).
- [ ] **Step 4:** Update `CLAUDE.md` (status → "v1 shipped", live URL, deploy command) and **commit + push** (device-sync rule).

---

## Milestone dependency order

```
M0 ─▶ M1 ─▶ M2 ─▶ M5 ─▶ M6 ─▶ M7
            │      ▲      ▲
            ▼      │      │
  M3 (pure logic, independent) ─────┘  (feeds M6 ranking)
            │
            ▼
           M4 (embedding) ─▶ M5 (import enqueues embeds)
```

M3 (pure logic) and M4 (embedder) can be built any time after M0; they have no UI dependency. M5 needs M4; M6 needs M3 + M5. Recommended linear order M0→M1→M2→M3→M4→M5→M6→M7 keeps a runnable app at every step.

## Notes / risks

- **transformers.js package:** plan uses `@huggingface/transformers` v3 (for WebGPU). If WebGPU proves flaky, the singleton already falls back to WASM. Model id `Xenova/clip-vit-base-patch32` works on both.
- **jsdom has no canvas/WebGPU:** canvas-touching code (downscale, thumbnail, embed) is verified manually, not unit-tested — by design (spec Section 8). The pure math around it (`fitDimensions`, `cosine`, ranking, queue ordering) is fully tested.
- **"Accept" semantics:** in v1, suggested neighbors are existing board nodes, so accept = draw a provenance edge (no new node). The store's `addImageNode` path is reserved for the future case of suggestions that aren't yet on the board.
- **Storage bucket policy:** keep permissive-but-authenticated for v1 (personal tool); tighten at spin-off.
```
