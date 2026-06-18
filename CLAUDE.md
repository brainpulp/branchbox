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

## Status: spec finalized — next step is the implementation plan

There is no code yet. Brainstorming is **complete**: all 8 design sections were approved and the finalized spec is committed at [`docs/2026-06-18-branchbox-spec.md`](docs/2026-06-18-branchbox-spec.md). (The older `docs/2026-06-18-branchbox-design.md` is the superseded in-progress notes.)

**To pick this up in a new session, tell Claude:**
> "Read CLAUDE.md and the spec in F:\code\branchbox, then use the writing-plans skill to produce the implementation plan."

Next step: invoke the `superpowers:writing-plans` skill against the spec to produce a detailed implementation plan. Only after the plan is approved should any code/scaffolding happen. Before coding, resolve the spec's "Implementation dependencies / open items" (PIM Supabase URL + anon key, PIM auth/RLS pattern, PIM table names for `bb_`-prefix collision check, exact PIM canvas files to fork).

## What this app is (target, once built)

A node-based, force-directed graph tool for organizing and exploring an image collection — built to solve the "getting lost in Pinterest's branching exploration" problem by keeping the exploration path visible and revisitable. Not a Pinterest scraper/companion — works on images you manually import.

## Planned stack (subject to change as design finishes)

- **Vite + React** (no TypeScript) — same as PIM
- **D3.js** force simulation — forked from PIM's canvas (`Graph.jsx` pattern: `AnimatedG`, `NodeShape`, Zustand store)
- **transformers.js** — in-browser CLIP-style embeddings (WebGPU/WASM), no backend compute
- **Supabase** — for now reuses **PIM's existing project + auth** (Branchbox treated as a backend sub-app of PIM), with `bb_`-prefixed tables + a `branchbox-images` bucket; spun off onto a dedicated project later. (Revised from the original "dedicated project" plan during the final brainstorm session.)
- **GitHub Pages** — same deploy pattern as PIM (`npm run deploy` → `gh-pages -d dist`)

## Key decisions already locked in (see design doc for full reasoning)

- Manual import only (paste/drag/upload) — no Pinterest scraping or API integration (ToS risk + no public browse API)
- Hybrid similarity: CLIP embeddings (primary) + optional user tags (nudge/override)
- Collapsed-by-default "expand neighbors" affordance, not auto-cluttering branches
- Target scale: tens–low hundreds of images per board (brute-force similarity search is fine, no ANN needed for v1)
- Multi-board support, like PIM
- Name: **Branchbox**

## Related projects

- [PIM](https://github.com/brainpulp/pim) (`F:\code\pim`) — the canvas engine Branchbox is forked from. Look here for the D3 force-sim / Zustand / NodeShape patterns this app will adapt.
