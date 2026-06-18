# Branchbox — Design (in progress)

**Status:** Brainstorming in progress. Section 1 of the design was presented and NOT yet confirmed by the user (conversation got interrupted by an unrelated PIM bug). Resume by re-presenting Section 1, get explicit approval, then continue through the remaining sections below.

## Problem statement

Pinterest's infinite, branching exploration makes it easy to get lost — you follow a chain of "related pins" and lose track of how you got there or what else you considered. Branchbox is a node-based, force-directed graph tool for organizing and exploring an image collection, where the branching path itself stays visible and navigable instead of disappearing into an endless scroll.

## Decisions made so far (via brainstorming Q&A)

1. **Framing:** General image-exploration/organization tool — not a live Pinterest scraper/companion. Pinterest is the inspiration, not a dependency. (Ruled out: browser extension, direct Pinterest API/scraping — both rejected due to ToS risk, scraping fragility, and Pinterest having no public "browse" API.)
2. **Data source:** Manual import only — paste, drag-drop, file upload. Both bulk import (e.g. a folder of saved images) and drip-feed (adding images one at a time over a session) should be supported, with more import methods possibly added later.
3. **Similarity basis:** Hybrid — CLIP-style visual/semantic embeddings as the primary signal, with optional user-added tags that can nudge or override the algorithmic similarity.
4. **Embedding compute location:** In-browser, via `transformers.js` (WebGPU/WASM), no backend compute needed. Fits the same static-hosting model as PIM (GitHub Pages).
5. **Relation to PIM:** New standalone repo/app. Fork PIM's force-directed canvas (D3 simulation, SVG rendering, Zustand store, `AnimatedG`/`NodeShape` pattern) as a starting template, then diverge for image-centric nodes.
6. **Persistence:** Persistent + synced, same pattern as PIM (own dedicated Supabase project, not shared).
7. **Branch interaction:** Hybrid — auto-suggest neighbors on node selection, but collapsed by default behind an "expand neighbors" affordance (reusing PIM's existing expand-hops UX pattern). Avoids auto-cluttering the canvas.
8. **Collection scale:** Tens to low hundreds of images per board — brute-force cosine similarity in JS is fine, no ANN indexing needed for v1.
9. **Multi-board support:** Yes, same pattern as PIM (switchable boards/projects from a sidebar).
10. **Name:** **Branchbox** (chosen over Treebox — "branch" doesn't imply strict single-parent hierarchy the way "tree" does, and this graph will have cross-links where separate exploration paths converge on a similar image).

## Section 1 — Overview & Architecture (presented, pending confirmation)

Branchbox is a standalone web app for organizing and exploring an image collection through a branching, force-directed node graph. New repo, forked from PIM's canvas engine as a starting template, then diverged specifically for image-centric nodes instead of text nodes. Same deploy pattern as PIM: static build to GitHub Pages, dedicated Supabase project for persistence.

Core interaction loop:
1. Import images (paste, drag-drop, or file upload) into a board.
2. Each image gets an embedding vector computed in-browser (transformers.js, CLIP-style model).
3. Select any image node → click an "expand neighbors" affordance → see its top-N most similar images from the board, suggested as new connected branch nodes.
4. Keep the ones you want, discard the rest, branch further from any node — building a visible map of your exploration instead of losing it to infinite scroll.

## Remaining design sections to present (not yet discussed)

- **Data model**: boards, image nodes (image blob/URL + embedding vector + optional tags), edges, how this maps onto/differs from PIM's `nodes`/`edges`/`views` shape.
- **Similarity engine details**: specific embedding model choice (e.g. a `Xenova/clip-vit-base-patch32` ONNX build via transformers.js), exact hybrid scoring formula (how tag overlap blends with/overrides cosine similarity), top-N neighbor selection and de-duplication against already-placed nodes.
- **Import flow**: UI for paste/drag/upload, where embeddings get computed (on import vs lazily), handling of duplicate images.
- **Branch/expand UX details**: what the collapsed affordance looks like, how many neighbors shown by default, accept/reject interaction, node layout/positioning for new branches (reuse PIM's force-sim placement?).
- **Storage schema**: Supabase tables (boards, images, embeddings — plain array column vs pgvector), image storage approach (Supabase storage bucket vs base64 inline, given images are heavier than PIM's text nodes).
- **MVP scope vs out-of-scope**: explicitly confirm Pinterest live integration, ANN indexing, and multi-device collaborative editing are NOT in v1.
- **Testing approach**: how to verify the similarity/branching UX actually works once built.

## Next step when resuming

Re-present Section 1 above, get explicit "looks good" from the user, then continue through the remaining sections one at a time (per the brainstorming skill's process — one section at a time, approval before moving on). Once all sections are approved, write the finalized spec, run it through spec review, then hand off to `writing-plans`.
