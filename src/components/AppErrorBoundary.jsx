import { Component } from 'react'

export default class AppErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Branchbox crashed:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={styles.wrap}>
          <div style={styles.card}>
            <h2 style={styles.title}>Something broke</h2>
            <pre style={styles.msg}>{String(this.state.error?.message || this.state.error)}</pre>
            <button style={styles.btn} onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const styles = {
  wrap: { display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0f0f0f' },
  card: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: '2rem', maxWidth: 480, textAlign: 'center' },
  title: { margin: '0 0 1rem', color: '#f87171', fontSize: '1.3rem' },
  msg: { color: '#aaa', fontSize: '0.82rem', whiteSpace: 'pre-wrap', textAlign: 'left', margin: '0 0 1.25rem' },
  btn: { padding: '0.6rem 1.25rem', borderRadius: 8, border: 'none', background: '#5b6af0', color: '#fff', cursor: 'pointer', fontWeight: 600 },
}
