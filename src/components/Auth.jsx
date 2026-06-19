import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setInfo(null)
    const fn = mode === 'signup'
      ? supabase.auth.signUp({ email, password })
      : supabase.auth.signInWithPassword({ email, password })
    const { data, error } = await fn
    if (error) setError(error.message)
    else if (mode === 'signup' && !data.session) setInfo('Check your email to confirm, then sign in.')
    setLoading(false)
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <h2 style={styles.title}>Branchbox</h2>
        <p style={styles.sub}>Visual exploration for image collections</p>
        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            style={styles.input}
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <input
            style={styles.input}
            type="password"
            placeholder="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          <button style={styles.btn} disabled={loading}>
            {loading ? '…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <button
          style={styles.toggle}
          onClick={() => { setMode(m => m === 'signup' ? 'signin' : 'signup'); setError(null); setInfo(null) }}
        >
          {mode === 'signup' ? 'Have an account? Sign in' : 'Need an account? Sign up'}
        </button>
        {info && <p style={styles.info}>{info}</p>}
        {error && <p style={styles.error}>{error}</p>}
      </div>
    </div>
  )
}

const styles = {
  wrap: { display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0f0f0f' },
  card: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: '2.5rem', width: 360, textAlign: 'center' },
  title: { margin: '0 0 0.25rem', fontSize: '1.8rem', color: '#fff', fontWeight: 700 },
  sub: { margin: '0 0 1.5rem', color: '#888', fontSize: '0.9rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  input: { padding: '0.75rem 1rem', borderRadius: 8, border: '1px solid #333', background: '#111', color: '#fff', fontSize: '1rem', outline: 'none' },
  btn: { padding: '0.75rem', borderRadius: 8, border: 'none', background: '#5b6af0', color: '#fff', fontSize: '1rem', cursor: 'pointer', fontWeight: 600 },
  toggle: { marginTop: '1rem', background: 'transparent', border: 'none', color: '#5b6af0', cursor: 'pointer', fontSize: '0.82rem' },
  info: { color: '#7dd3a8', marginTop: '0.75rem', fontSize: '0.85rem' },
  error: { color: '#f87171', marginTop: '0.75rem', fontSize: '0.85rem' },
}
