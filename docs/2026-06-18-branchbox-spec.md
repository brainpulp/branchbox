# Branchbox — Design Spec (v1)

**Status:** Finalized via brainstorming, pending implementation plan.
**Date:** 2026-06-18
**Supersedes:** the in-progress notes in `docs/2026-06-18-branchbox-design.md`.

## Problem statement

Pinterest's infinite, branching exploration makes it easy to get lost — you follow a chain of "related pins" and lose track of how you got there or what else you considered. **Branchbox** is a node-based, force-directed graph tool for organizing and exploring an image collection, where the branching exploration path itself stays visible and revisitable instead of disappearing into an endless scroll.

It is a general image-exploration/organization tool inspired by Pinterest — **not** a live Pinterest scraper or companion. You import your own images; Branchbox helps you explore relationships between them.

---

## Section 1 — Overview & Architecture

Branchbox is a web app for organizing and exploring an image collection through a branching, force-directed node graph. It is **forked from PIM's canvas engine** (D3 force simulation, SVG rendering, Zustand store, `AnimatedG` / `NodeShape` pattern) as a starting template, then diverged for **image-centric nodes** instead of text nodes.

**Core interaction loop:**
1. Import images (paste, drag-drop, or file upload) into a board.
2. Each image gets a CLIP-style embedding vector computed **in-browser** (transformers.js, WebGPU with WASM fallback — no backend compute).
3. Select an image node → click its **"expand neighbors"** affordance → see its top-N most similar images from the board, suggested as new connected branch nodes.
4. Keep the ones you want, discard the rest, branch further from any node — building a **visible, revisitable map** of your exploration.

**Stack:** Vite + React (no TypeScript), D3 force simulation, transformers.js for embeddings, Supabase for persistence, GitHub Pages for hosting.

**Deployment / backend (revised — see Section 7):** Branchbox is its **own repo** (`F:\code\branchbox`) and its **own GitHub Pages deploy**, but for now it reuses **PIM's existing Supabase project and auth** rather than a dedicated project. It is treated as a "sub-app" of PIM at the backend level, to be spun off onto a dedicated Supabase project later. Its tables are namespaced (`bb_` prefix) to avoid colliding with PIM's.

---

## Section 2 — Data Model

Mirrors PIM's in-memory `nodes` / `edges` arrays so the forked canvas engine works with minimal change. Persistence stores these arrays as JSONB inside one board row (see Section 6) — so `imageNode`/`edge` objects live *inside* a board's `nodes`/`edges` arrays and carry no `board_id`/`created_at` of their own.

- **`board`** (the persisted row) — `{ id, user_id, name, nodes[], edges[], created_at, updated_at }`
- **`imageNode`** (element of `board.nodes`) — `{ id, imageRef, thumbRef, w, h, embedding[], tags[], x, y }`
  - `imageRef` / `thumbRef`: object paths into the Supabase Storage bucket (see Section 6)
  - `embedding[]`: the CLIP vector (the single v1 similarity "lens")
  - `tags[]`: optional user tags that nudge similarity
  - `x, y`: last force-sim position, so layout persists across loads
- **`edge`** (element of `board.edges`) — `{ id, source, target, kind }`
  - `source` / `target` are `imageNode.id`s; v1 always writes `kind: 'branch'` (provenance — "I branched B from A")

**Forward-compatible seams (designed, not built in v1):**
1. **`edge.kind` discriminator** — future AI-discovered relationships become edges with `kind: 'palette' | 'material' | 'origin' | 'semantic' | …`, coexisting on the same graph with toggleable visibility.
2. **Pluggable similarity "lenses"** — v1 has exactly one lens (CLIP visual/semantic). Palette, material, origin, etc. are future lenses that each produce their own edges.

**Deferred (YAGNI):** PIM's `views` concept (saved camera/filter states) is not in v1.

---

## Section 3 — Similarity Engine

**Edges represent provenance; similarity only drives *suggestions*.** When you expand a node, similarity ranks candidate neighbors; keeping one creates a permanent provenance edge regardless of whether the two stay similar.

- **Model:** `Xenova/clip-vit-base-patch32` via transformers.js — standard in-browser CLIP build, ~150MB (cached after first load), WebGPU with WASM fallback. Sufficient fidelity for tens-to-low-hundreds of images.
- **Search:** brute-force cosine similarity. On expand, compute cosine of the selected node's vector against every other node's vector, sort descending. No ANN (scale doesn't warrant it).
- **Hybrid scoring (weighted blend / "nudge"):** `score = cosine + λ · tagOverlap`. Shared tags gently re-rank candidates upward but never force a result. One tunable knob (`λ`). "Override" behavior is intentionally deferred to the future tag-lens rather than special-cased now.
  - **`tagOverlap` definition:** Jaccard similarity over the two nodes' tag sets — `|shared tags| / |union of tags|` (0 when either node is untagged). Bounded to `[0,1]`, matching cosine's range so `λ` is interpretable.
  - **`λ` default:** start at `0.15` (a shared-tag nudge is a meaningful but sub-dominant signal vs. visual similarity); expose as a constant so it's easy to tune during manual verification.
- **Dedup:** candidates already placed on the canvas (already a node, or already connected) are filtered out of suggestions.
- **Default neighbor count:** top **5**, with a "show more" action to load the next 5.

---

## Section 4 — Import Flow

- **Methods:** paste from clipboard, drag-drop (single or many), file-picker upload. Supports both bulk import and one-at-a-time drip-feed.
- **Duplicate handling:** hash each image's bytes on import; an *exact* byte-duplicate is skipped with a small toast ("already on this board"). **Near-duplicates are never filtered** — surfacing visually-similar-but-different images is the point of the tool.
- **Downscale on import:** store a downscaled original (longest edge ~1600px) plus a ~256px thumbnail. Branchbox is an exploration/moodboard tool, not an asset manager.
- **Embedding timing — eager, queued with progress:** on import each image becomes a canvas node *immediately* in a "computing…" state. A background queue embeds them one at a time (throttled so the tab stays responsive); each node flips to "ready" (expandable) as its vector lands. You can keep importing and arranging while the queue churns.
- **Model first-load & failure state:** the ~150MB CLIP model downloads once on first use (cached thereafter). Show a one-time "loading similarity model…" state before the queue can start, and a recoverable error state if the model fails to load (e.g. WebGPU/WASM unavailable or network failure) — imported images still appear as nodes; they just stay un-embedded (not expandable) with a retry affordance, rather than blocking import.

---

## Section 5 — Branch / Expand UX

**Chosen design: "Peek & fan" (hybrid).**

- **Collapsed affordance:** a small **"+N" pill** on a node (e.g. "+5") indicating how many suggested neighbors are available. This is the honest, low-clutter resting state — you see there's more to explore without the canvas filling up.
- **Expand:** clicking the pill **fans out** the top-N candidates as translucent "ghost" nodes arranged radially around the source (reusing PIM's expand-hops feel and the force sim for placement).
- **Accept / reject:** inline on each ghost node — ✓ keep (solidifies the node, writes a provenance edge, computes *its* neighbor count) or ✕ drop (fades it). You can then branch further from any kept node.
- **Default:** top 5 ghosts, with "show more" to fan the next 5.
- **Placement:** new branch nodes use the force simulation for positioning, same as PIM.

---

## Section 6 — Storage Schema (Supabase)

**Revised (2026-06-18) to match PIM's proven pattern: one JSONB-blob row per board, not separate relational tables.** PIM persists each board as a single `public.pim_projects` row with `nodes` / `edges` / `views` as JSONB columns; Branchbox mirrors this for consistency, simplicity, and because the client-side brute-force similarity loads the entire board anyway (one-row load is ideal).

**One table — `public.bb_boards`** in **PIM's existing Supabase project** (`ikztpvxfgmhmrcwolwgx`, `public` schema, no `.schema()` call — same as PIM's `db.js`):

| column | type | notes |
|--------|------|-------|
| `id` | uuid pk (default `gen_random_uuid()`) | board id |
| `user_id` | uuid | FK to `auth.users`, for RLS — same pattern as `pim_projects` |
| `name` | text | board name |
| `nodes` | jsonb | array of image-node objects (see below) |
| `edges` | jsonb | array of edge objects `{ id, source, target, kind }` |
| `created_at` | timestamptz default `now()` | |
| `updated_at` | timestamptz | bumped on every save |

**`nodes` JSONB element shape** (matches the in-memory model, Section 2):
```js
{ id, imageRef, thumbRef, w, h, embedding: number[], tags: string[], x, y }
```
- `imageRef` / `thumbRef`: object paths into the storage bucket (e.g. `"<boardId>/<nodeId>.jpg"` and `"<boardId>/<nodeId>.thumb.jpg"`). Resolve to public URLs at load time, same as PIM's `getPublicUrl`.
- `embedding`: the CLIP vector as a plain JSON number array. A few hundred nodes × 512 floats ≈ a sub-MB JSONB row — fine for v1's "tens to low hundreds" scale. (If a board ever outgrows this, splitting embeddings into a side table is the spin-off-era migration — out of scope now.)

**Other decisions:**
- **No pgvector.** Similarity runs client-side over the loaded vectors. pgvector only earns its keep for server-side ANN, which is out of scope.
- **Image bytes → Supabase Storage bucket (`branchbox-images`), never base64 inline.** The JSONB stores only paths. Thumbnails load for canvas rendering; full (downscaled) images load lazily. (Mirrors PIM's `pim-models` bucket + `imageRef`/`thumbRef` URL pattern.)
- **RLS:** `bb_boards` is a new table, so it needs **its own RLS policies written** — `user_id = auth.uid()` for select/insert/update/delete, identical in spirit to `pim_projects`. "Reuse PIM's scoping" = same auth session + same user-id predicate, not inherited policies; writing these policies is an explicit implementation task.

---

## Section 7 — Scope

**In scope (v1):**
- Multi-board: create / switch / delete (sidebar, PIM-style)
- Import: paste, drag-drop, upload; bulk + drip; downscale + thumbnail + byte-hash dedup
- In-browser CLIP embedding, eager queued with per-node computing→ready states
- Force-directed canvas forked from PIM, with image nodes
- Provenance edges (`kind: 'branch'`)
- Expand neighbors: "+N" pill → fan-out ghosts, inline accept/reject, top 5 + "show more"
- Weighted-blend similarity (client-side cosine + tag nudge)
- Tags: add / edit on nodes
- Persistence via PIM's Supabase project (single `bb_boards` JSONB-blob table + `branchbox-images` bucket), reusing PIM's auth
- GitHub Pages deploy (own site)

**Out of scope (v1):**
- Pinterest live integration / scraping
- ANN indexing / pgvector
- Real-time multi-device collaborative editing
- Multi-lens relationship discovery (palette / material / origin) — *seam left via `edge.kind` + lens structure, not built*
- Saved views (camera / filter states)
- Dedicated Supabase project (deferred until spin-off)

**Auth / backend decision:** reuse PIM's Supabase auth and project for now; treat Branchbox as a backend sub-app of PIM. Spin off onto a dedicated repo-already-exists + dedicated Supabase project later — a mechanical move (re-point Supabase config, re-prefix/migrate tables).

---

## Section 8 — Testing Approach

**Automated (Vitest unit tests on pure logic — the real bug surface):**
- Cosine similarity
- Weighted-blend scoring (`cosine + λ·tagOverlap`) ranking under varied tag overlap
- Dedup (already-placed neighbors filtered) and top-N selection
- Byte-hash duplicate detection

**Key technique:** test the similarity engine with **hand-crafted fixture vectors**, not real CLIP output — deterministic, fast, no 150MB model download in the test run. ("Given these 6 vectors, expanding X returns Y, Z in that order.")

**Component/store tests:** expand → accept/reject mutates the Zustand store correctly (right nodes/edges added, ghosts cleared).

**Manual verification:** a short checklist run in the real browser with known-similar fixture images, because suggestion *quality* ("do these feel similar?") is a judgment call no assertion captures. Matches the verify-in-browser-before-done rule.

**Out of scope:** heavyweight Playwright E2E driving the full real-model pipeline — high setup/maintenance cost for a personal tool, and it still can't judge similarity quality.

---

## Implementation dependencies / open items for the plan

Resolved during plan-time exploration of PIM (`F:\code\pim`):
- **Supabase project:** PIM's dedicated project is `ikztpvxfgmhmrcwolwgx` (`public` schema). Branchbox reuses the **same** `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, points `db.js` at `supabase.from('bb_boards')` (no `.schema()` call — matches PIM), and creates a `branchbox-images` storage bucket.
- **Auth:** email+password via `supabase.auth.signInWithPassword` / `signUp` (PIM's `Auth.jsx` pattern). Same user account (maxi.goldschwartz@gmail.com).
- **RLS:** write `user_id = auth.uid()` policies for `bb_boards` (no inherited policies; PIM's `pim_projects` is the template).
- **Canvas:** **extract the patterns** from PIM's `Graph.jsx` (3355-line monolith) — the D3-sim↔React integration (`simRef` / `simNodesRef` / rAF-throttled `setTick`), `NodeShape`, `AnimatedG`, `alphaDecay 0.015`, anchor-on-drag — into a **lean image-node canvas**. Do **not** copy the monolith wholesale (it carries 3D nodes, slideshows, frames, drill, presentation, views that Branchbox doesn't need). This is the "fork as template, then diverge" intent.

Still to confirm at implementation time:
- Run the `bb_boards` table + RLS + bucket creation against project `ikztpvxfgmhmrcwolwgx` (via Supabase MCP or dashboard) before wiring `db.js`.

## Next step

Hand off to the `writing-plans` skill to produce a detailed implementation plan.
