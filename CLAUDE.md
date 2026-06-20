# Branchbox — Claude Working Document

## ⚠️ DEVICE SYNC — CRITICAL RULE
**Before switching devices or ending a session, ALWAYS:**
```bash
git add -A && git commit -m "wip: session end" && git push
```
**Before starting work on any device, ALWAYS:**
```bash
git pull
```
Work built locally but not pushed is lost when the other device takes over. No exceptions.

---

## 🟢 HANDOFF — START HERE (resume on a new device)

**Status (2026-06-20): M0–M5 built, tested, and pushed.** The app imports images
end-to-end. Next up is **M6 (expand/branch fan UX)**, then **M7 (persistence + deploy)**.

- **Done:** M0 scaffold · M1 Supabase data layer + auth + boards shell · M2 board store +
  lean D3 canvas · M3 imageUtils + similarity (TDD) · M4 CLIP embedder + embed queue ·
  **M5 import flow** (`ImportDropzone`, hash-dedup → downscale/thumb → upload → embed;
  load/error status chip). 18 vitest tests green.
- **Backend is live** in PIM's Supabase project (`ikztpvxfgmhmrcwolwgx`): `bb_boards`
  table (RLS on) + `branchbox-images` bucket both exist. `.env.local` holds the URL +
  anon key (gitignored — recreate from `.env.example` via Supabase MCP on a new device).
- **In-flight branch:** `claude/great-maxwell-s29j0u` (draft PR
  [#1](https://github.com/brainpulp/branchbox/pull/1)), not merged to `master`.
- **Deploy is staged but not live:** `gh-pages` branch is built + pushed, but the repo is
  **private with Pages disabled** (HTTP 403). To go live: make the repo public, then
  Settings → Pages → Source = `gh-pages` branch / root. Not yet done.
- **Not built yet:** M6 (the "+N" pill → fan-out ghost suggestions → accept/reject →
  provenance edge; tag editing) and M7 (JSONB autosave/load so boards survive reload).
  Until M7, a reload wipes the in-session board.

On a fresh device:
1. `git pull` then `npm install` in `F:\code\branchbox`.
2. Recreate `.env.local` from `.env.example` (Supabase MCP `get_project_url` +
   `get_publishable_keys` for project `ikztpvxfgmhmrcwolwgx`).
3. Tell Claude:
   > "Read CLAUDE.md and `docs/2026-06-18-branchbox-implementation-plan.md`, then continue
   > the plan at M6 using superpowers:executing-plans."

**Key docs (all in `docs/`):**
- `2026-06-18-branchbox-implementation-plan.md` — **the build plan.** Milestones M0–M7, task-by-task, TDD steps, exact code/commands. This is what you execute.
- `2026-06-18-branchbox-spec.md` — the finalized design spec (the "why" + decisions).
- `2026-06-18-branchbox-design.md` — superseded brainstorm notes (ignore; kept for history).

---

## What this app is

A node-based, force-directed graph tool for organizing and exploring an image collection — solving the "getting lost in Pinterest's branching exploration" problem by keeping the exploration path visible and revisitable. Manual image import only (paste/drag/upload); not a Pinterest scraper. Select an image → expand its most visually-similar neighbors → keep/discard → branch further, building a visible map.

## Stack

- **Vite + React** (no TypeScript) — same as PIM
- **D3.js** force simulation — a *lean* fork: extract the patterns from PIM's `Graph.jsx` (D3-sim↔React via `simRef`/`simNodesRef`/rAF `setTick`, `NodeShape`, `AnimatedG`, `alphaDecay`, anchor-on-drag), do **not** copy the 3355-line monolith wholesale.
- **transformers.js** (`@huggingface/transformers` v3, for WebGPU) — in-browser CLIP embeddings (`Xenova/clip-vit-base-patch32`), WebGPU→WASM fallback. No backend compute.
- **Zustand** — board state (`src/lib/boardStore.js`), mirrors PIM's `graphStore.js` minus views/slides/3D.
- **Supabase** — reuses **PIM's existing project + auth** (sub-app of PIM), single `bb_boards` JSONB-blob table + `branchbox-images` bucket. Spun off onto a dedicated project later.
- **Vitest + jsdom + @testing-library/react** — unit tests on pure logic (PIM has none; Branchbox adds them).
- **GitHub Pages** — `base: '/branchbox/'`, `npm run deploy` → `gh-pages -d dist`. Live (once shipped): https://brainpulp.github.io/branchbox/

## Locked design decisions

- Manual import only (paste/drag/upload, downscaled to ~1600px longest edge + 256px thumb).
- Similarity: brute-force **cosine** + **Jaccard tag nudge** (`score = cosine + 0.15·tagOverlap`), all client-side. No ANN/pgvector.
- Embeddings computed **eagerly** on import via a throttled queue; nodes go `computing → ready`.
- Edges = **provenance** (`kind: 'branch'`). `edge.kind` + a "lens" structure are seams left for future AI relationship discovery (palette/material/origin) — NOT built in v1.
- Expand UX: collapsed **"+N" pill** on a node → click → **fan out** top-5 ghost nodes radially → inline ✓ accept (draw provenance edge) / ✕ reject → "show more" for next 5.
- Multi-board, PIM-style sidebar. Target scale: tens–low hundreds of images/board.
- Storage: one JSONB row per board (PIM's pattern), `nodes`/`edges` as JSONB columns; image bytes in bucket, embeddings inline in node JSONB.
- Out of scope v1: Pinterest integration, ANN/pgvector, realtime collab, multi-lens discovery, saved views, dedicated Supabase project.

## Supabase backend (reuses PIM's project)

- **Project:** `ikztpvxfgmhmrcwolwgx` (PIM's dedicated project, `public` schema). Branchbox uses the **same** `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (copy from `F:\code\pim\.env.local`, or Supabase MCP `get_project_url` + `get_publishable_keys`).
- **Table to create:** `public.bb_boards` `{ id uuid pk, user_id uuid → auth.users, name text, nodes jsonb, edges jsonb, created_at, updated_at }` + RLS (`auth.uid() = user_id` for all four ops). Exact SQL is in plan task **M1.1**.
- **Bucket to create:** `branchbox-images` (public). Authenticated-insert/select policy (permissive OK for personal tool v1).
- **db.js pattern:** `supabase.from('bb_boards')` with **no `.schema()` call** (mirrors PIM — `.schema('pim')` caused "Invalid schema" errors there).
- **Auth:** email+password (`signInWithPassword`/`signUp`), same account: maxi.goldschwartz@gmail.com.

## Milestone roadmap (full detail in the plan)

- **M0** — scaffold Vite+React+Vitest, app placeholder, deployable skeleton.
- **M1** — create `bb_boards`+RLS+bucket; `supabase.js`, `db.js`, `Auth.jsx`, `Boards.jsx`, `App.jsx` shell (all mirror PIM).
- **M2** — `boardStore.js` (TDD) + lean D3 canvas (`Board.jsx`, `ImageNode.jsx`) with manual test nodes.
- **M3** — pure logic, heavy TDD: `imageUtils.js` (hash, fitDimensions) + `similarity.js` (cosine, jaccard, topNeighbors) with fixture vectors.
- **M4** — `embedder.js` (CLIP singleton, load/error states) + `embedQueue.js` (TDD with injected embed fn).
- **M5** — import flow: `ImportDropzone.jsx`, `importFiles` (downscale→thumb→hash-dedup→upload→enqueue), embedder load/error UX.
- **M6** — expand/branch UX: "+N" pill, fan-out ghosts, accept/reject, "show more", tag editing.
- **M7** — JSONB save/load persistence, manual verification checklist, deploy to GitHub Pages.

Order is mostly linear (M0→M7); M3 (pure logic) and M4 (embedder) have no UI dependency and can be built any time after M0.

## PIM patterns/gotchas to reuse (reference: `F:\code\pim`, READ-ONLY)

- `src/lib/supabase.js` — copy 1:1. `src/lib/db.js` — pattern for CRUD + storage upload (`uploadModel`/`uploadThumbnail` → adapt to `uploadImage`).
- `src/components/Auth.jsx` — copy, rebrand "PIM"→"Branchbox". `src/pages/Projects.jsx` → `Boards.jsx` (rename project→board). `src/App.jsx` — auth-gate shape (`session===undefined`→loading, `!session`→Auth, localStorage last-board, `AppErrorBoundary`); drop the table/graph nav toggle.
- D3 sim values (PIM `Graph.jsx`): `forceLink(distance 120, strength 0.4)`, `forceManyBody(-300)`, `forceCollide(NODE_R+8)`, `alphaDecay 0.04`, rAF-throttled `setTick`. **TDZ gotcha:** never reference a `const` declared later in the same function inside a `useEffect` deps array (silent prod crash).
- **PowerShell:** never use Get-Content/Set-Content on files with emoji/Unicode (mangles them) — use the Read/Write/Edit tools.

## Related projects

- [PIM](https://github.com/brainpulp/pim) (`F:\code\pim`) — the canvas/auth/db engine Branchbox forks patterns from, and whose Supabase project it shares for now.

## Repo

- GitHub: https://github.com/brainpulp/branchbox (private) · local: `F:\code\branchbox`
