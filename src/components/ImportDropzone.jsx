import { useEffect, useRef, useState } from 'react'

// Wraps the canvas as an image drop target and provides a file-pick button +
// a window paste listener. All three routes funnel into onFiles(FileList|File[]).
export default function ImportDropzone({ onFiles, children }) {
  const inputRef = useRef(null)
  const [dragActive, setDragActive] = useState(false)

  // Paste anywhere → grab image blobs off the clipboard.
  useEffect(() => {
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.items || [])]
        .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
        .map(it => it.getAsFile())
        .filter(Boolean)
      if (files.length) { e.preventDefault(); onFiles(files) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [onFiles])

  return (
    <div
      style={{ position: 'relative', height: '100%', overflow: 'hidden' }}
      onDragOver={e => { e.preventDefault(); if (!dragActive) setDragActive(true) }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragActive(false) }}
      onDrop={e => {
        e.preventDefault(); setDragActive(false)
        const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'))
        if (files.length) onFiles(files)
      }}
    >
      <button style={addBtn} onClick={() => inputRef.current?.click()}>＋ Add images</button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={e => { if (e.target.files.length) onFiles(e.target.files); e.target.value = '' }}
      />
      {children}
      {dragActive && (
        <div style={dropOverlay}>
          <span style={dropLabel}>Drop images to add</span>
        </div>
      )}
    </div>
  )
}

const addBtn = {
  position: 'absolute', top: 12, left: 12, zIndex: 10,
  padding: '0.4rem 0.8rem', borderRadius: 8, border: '1px solid #2d3a6a',
  background: '#111118', color: '#c5d0ff', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
}

const dropOverlay = {
  position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none',
  border: '3px dashed #5b6af0', borderRadius: 12, background: 'rgba(91,106,240,0.08)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const dropLabel = { color: '#c5d0ff', fontSize: '1.1rem', fontWeight: 600 }
