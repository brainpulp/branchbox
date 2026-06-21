import { publicUrl } from '../lib/db'
import { NODE_R } from '../lib/boardStore'

const SIZE = NODE_R * 2

// thumbRef may be a stored object path (resolve via publicUrl) or, for test
// nodes, a direct http(s) URL — use it as-is in that case.
function resolveSrc(ref) {
  if (!ref) return null
  return /^https?:|^blob:|^data:/.test(ref) ? ref : publicUrl(ref)
}

export default function ImageNode({ node, x, y, isSelected, dimmed, canDiscover = false, onMouseDown, onExpand }) {
  const src = resolveSrc(node.thumbRef)
  const clipId = `clip-${node.id}`
  if (x == null || y == null) return null

  return (
    <g
      data-node
      transform={`translate(${x - NODE_R},${y - NODE_R})`}
      opacity={dimmed ? 0.2 : 1}
      onMouseDown={e => onMouseDown(e, node.id)}
      onClick={e => e.stopPropagation()} // keep node clicks from clearing selection
      style={{ cursor: 'grab' }}
    >
      <clipPath id={clipId}>
        <rect width={SIZE} height={SIZE} rx={10} ry={10} />
      </clipPath>
      <rect width={SIZE} height={SIZE} rx={10} ry={10} fill="#1a1a2e" />
      {src && (
        <image
          href={src}
          width={SIZE}
          height={SIZE}
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${clipId})`}
        />
      )}
      <rect
        width={SIZE}
        height={SIZE}
        rx={10}
        ry={10}
        fill="none"
        stroke={isSelected ? '#5b6af0' : '#2a2a3e'}
        strokeWidth={isSelected ? 2.5 : 1.5}
      />
      {node.status === 'computing' && (
        <>
          <rect width={SIZE} height={SIZE} rx={10} ry={10} fill="#0a0a14" opacity={0.6} />
          <text x={NODE_R} y={NODE_R} textAnchor="middle" dominantBaseline="middle"
            fontSize={10} fill="#9aa" style={{ userSelect: 'none' }}>computing…</text>
        </>
      )}
      {node.tags?.length > 0 && (
        <text x={NODE_R} y={SIZE + 12} textAnchor="middle" fontSize={9} fill="#8090b8"
          style={{ userSelect: 'none', pointerEvents: 'none' }}>{node.tags.join(' · ')}</text>
      )}
      {canDiscover && onExpand && (
        <g
          transform={`translate(${SIZE - 10},10)`}
          style={{ cursor: 'pointer' }}
          onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}
          onClick={e => { e.stopPropagation(); onExpand(node.id) }}
        >
          <title>Discover similar images</title>
          <circle r={12} fill="#5b6af0" stroke="#0c0c1a" strokeWidth={1.5} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={13}
            fill="#fff" style={{ userSelect: 'none' }}>✦</text>
        </g>
      )}
    </g>
  )
}
