-- Branchbox v1 — Supabase backend setup
-- Applied to PIM's project ikztpvxfgmhmrcwolwgx on 2026-06-18.
-- Recorded here for the record (M1.1). Branchbox is a sub-app of PIM and
-- reuses PIM's project + auth; objects are prefixed bb_ / branchbox-.

-- ── Migration: bb_boards_init ────────────────────────────────────────────
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

-- ── Migration: branchbox_images_bucket ───────────────────────────────────
-- Public bucket (mirrors PIM's pim-models): public read, authenticated writes.
insert into storage.buckets (id, name, public)
values ('branchbox-images', 'branchbox-images', true)
on conflict (id) do nothing;

create policy "branchbox_images_public_read" on storage.objects
  for select to public using (bucket_id = 'branchbox-images');
create policy "branchbox_images_auth_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'branchbox-images');
create policy "branchbox_images_auth_update" on storage.objects
  for update to authenticated using (bucket_id = 'branchbox-images');
create policy "branchbox_images_auth_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'branchbox-images');
