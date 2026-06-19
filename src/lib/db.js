import { supabase } from './supabase'

// Branchbox stores one JSONB-blob row per board in public.bb_boards
// (no .schema() call — mirrors PIM, where .schema('pim') caused errors).
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
