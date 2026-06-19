import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import AppErrorBoundary from './components/AppErrorBoundary'
import Auth from './components/Auth'
import Boards from './pages/Boards'
import Board from './pages/Board'

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading
  // Initialize board synchronously from localStorage — avoids race with onAuthStateChange
  const [board, setBoard] = useState(() => {
    try {
      const saved = localStorage.getItem('bb_last_board')
      return saved ? JSON.parse(saved) : null
    } catch { return null }
  })

  const openBoard = (id, name) => {
    localStorage.setItem('bb_last_board', JSON.stringify({ id, name }))
    setBoard({ id, name })
  }
  const closeBoard = () => {
    localStorage.removeItem('bb_last_board')
    setBoard(null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) { setBoard(null); localStorage.removeItem('bb_last_board') }
    })
    return () => subscription.unsubscribe()
  }, [])

  let content
  if (session === undefined) content = <div style={loadingStyle}>Loading…</div>
  else if (!session) content = <Auth />
  else if (!board) content = <Boards onOpen={openBoard} onSignOut={() => supabase.auth.signOut()} />
  else content = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f0f0f' }}>
      <nav style={navStyle}>
        <button style={backBtnStyle} onClick={closeBoard} title="All boards">← Boards</button>
        <span style={boardNameStyle}>{board.name}</span>
        <button style={signOutStyle} onClick={() => supabase.auth.signOut()}>Sign out</button>
      </nav>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Board boardId={board.id} boardName={board.name} onBack={closeBoard} />
      </div>
    </div>
  )

  return <AppErrorBoundary>{content}</AppErrorBoundary>
}

const navStyle = {
  display: 'flex', alignItems: 'center', gap: '0.75rem',
  padding: '0 1rem', height: 44, background: '#111118',
  borderBottom: '1px solid #1e1e2e', flexShrink: 0, zIndex: 100,
}
const backBtnStyle = {
  padding: '0.25rem 0.7rem', borderRadius: 6, border: '1px solid #2a2a3e',
  background: 'transparent', color: '#5b6af0', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
}
const boardNameStyle = {
  fontSize: '0.85rem', color: '#888', fontWeight: 500,
  maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
const signOutStyle = {
  marginLeft: 'auto', padding: '0.25rem 0.75rem', borderRadius: 6,
  border: '1px solid #2a2a3e', background: 'transparent', color: '#555',
  cursor: 'pointer', fontSize: '0.78rem',
}
const loadingStyle = {
  height: '100vh', display: 'flex', alignItems: 'center',
  justifyContent: 'center', color: '#555', background: '#0f0f0f',
}
