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

## Status: pre-implementation — brainstorming in progress

There is no code yet. This repo currently holds only the design-in-progress doc.

**To pick this up in a new session, tell Claude:**
> "Read CLAUDE.md in F:\code\branchbox and pick up the Branchbox brainstorm where we left off."

Claude should then:
1. Read `docs/2026-06-18-branchbox-design.md` for full context (problem statement, all decisions made so far, and which design sections are still pending).
2. Re-present Section 1 (Overview & Architecture) and get explicit approval — it was presented once but the conversation got derailed by an unrelated PIM bug before the user confirmed it.
3. Continue through the remaining design sections one at a time (data model, similarity engine details, import flow, branch/expand UX, storage schema, MVP scope, testing approach), per the `superpowers:brainstorming` skill process.
4. Once all sections are approved, finalize the spec, run the spec-review loop, then hand off to `writing-plans` to produce an implementation plan. Only then should any code/scaffolding happen.

## What this app is (target, once built)

A node-based, force-directed graph tool for organizing and exploring an image collection — built to solve the "getting lost in Pinterest's branching exploration" problem by keeping the exploration path visible and revisitable. Not a Pinterest scraper/companion — works on images you manually import.

## Planned stack (subject to change as design finishes)

- **Vite + React** (no TypeScript) — same as PIM
- **D3.js** force simulation — forked from PIM's canvas (`Graph.jsx` pattern: `AnimatedG`, `NodeShape`, Zustand store)
- **transformers.js** — in-browser CLIP-style embeddings (WebGPU/WASM), no backend compute
- **Supabase** — own dedicated project (not shared with PIM/gastos), for persistent multi-board storage
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
