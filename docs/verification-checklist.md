# Branchbox v1 — Manual verification checklist (spec §8)

Run on the live site: **https://brainpulp.github.io/branchbox/** (the user tests on the
deploy, not localhost). Use ~8 known-similar fixture images — e.g. **4 chairs + 4
landscapes** — so similarity quality is judgeable by eye.

## Auth & boards
- [ ] Sign in (email + password) → lands on the boards picker.
- [ ] Create a board → opens an empty canvas.
- [ ] "← Boards" returns to the picker; reopening the board returns to the canvas.

## M5 — Import
- [ ] Drag 3–4 images onto the canvas → they appear as **computing…**, then flip to ready
      (thumbnails render) as the CLIP model finishes (first load downloads ~20 MB).
- [ ] Paste an image from the clipboard → same flow.
- [ ] Use **＋ Add images** (file picker) → same flow.
- [ ] Drop a **duplicate** of an already-imported image → toast "Skipped a duplicate", no
      second node.
- [ ] Confirm the `branchbox-images` bucket has the uploaded objects (Supabase dashboard).
- [ ] Embedder status chip: throttle network / reload → "loading similarity model…" shows
      then clears. (Optional) block the HF CDN → error chip + **retry** re-embeds.

## M6 — Expand / branch
- [ ] Import all 8 fixtures; let them reach ready.
- [ ] Select a **chair** → **"+N" pill** shows a plausible count.
- [ ] Click the pill → ghost fan opens; **the other chairs rank above the landscapes**
      (subjective quality gate). Real nodes shown as ghosts are dimmed (no duplicates).
- [ ] **✓ accept** two → provenance edges drawn; canvas re-settles.
- [ ] **✕ reject** one → it disappears and does not return on **show more**.
- [ ] **show more** → reveals further candidates.
- [ ] Branch again from an accepted node (it becomes a new source with its own pill).
- [ ] **Esc** / click empty canvas → fan closes, dimming clears.

## M6.3 — Tags nudge ranking
- [ ] Give two otherwise-unrelated images a shared tag.
- [ ] Expand from one → the shared-tag image ranks **higher** than before (visible re-order).
- [ ] Remove a tag chip (✕) → ranking reverts.

## M7 — Persistence & isolation
- [ ] Arrange + branch + tag, then **reload** → identical board: positions, edges,
      thumbnails, tags all restored.
- [ ] Open a **second** board → isolated (no bleed-through of nodes/edges).
- [ ] **Sign out and back in** → only your own boards/images are visible (RLS scoping).

## Results
_Record pass/fail + any issues here; loop back to the relevant milestone to fix._

- Date:
- Tester:
- Notes:
