import { useEffect, useMemo, useState } from 'react'
import type { ToolMessage } from '../types'
import { toolLabel } from '../lib/tool-meta'
import { cn } from '../lib/utils'

const GRID = 16
const CENTER = 7.5

interface Cell {
  x: number
  y: number
  angle: number
}

/** Pixel ring, clockwise from the end of the opening; the moon sits in the opening itself. */
function buildRing(): Cell[] {
  const cells: Cell[] = []
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const dx = x - CENTER
      const dy = y - CENTER
      const distance = Math.hypot(dx, dy)
      if (distance < 5.1 || distance > 6.7) continue
      // Angle measured clockwise from "up"; the opening spans the upper right.
      const angle = (Math.atan2(dx, -dy) * 180) / Math.PI
      const turn = (angle + 360) % 360
      if (turn > 22 && turn < 78) continue
      cells.push({ x, y, angle: (turn - 78 + 360) % 360 })
    }
  }
  return cells.sort((a, b) => a.angle - b.angle)
}

const PROMPT: Array<[number, number]> = [
  [5, 5],
  [6, 6],
  [7, 7],
  [6, 8],
  [5, 9],
  [8, 10],
  [9, 10],
]

function ringColor(index: number, total: number) {
  const t = total <= 1 ? 0 : index / (total - 1)
  const from = t < 0.45 ? [216, 219, 255] : [142, 150, 255]
  const to = t < 0.45 ? [142, 150, 255] : [79, 198, 234]
  const local = t < 0.45 ? t / 0.45 : (t - 0.45) / 0.55
  const mix = from.map((value, channel) => Math.round(value + (to[channel] - value) * local))
  return `rgb(${mix.join(',')})`
}

export type ActivityMode = 'orbit' | 'build'

/**
 * The Lunarcode mark in pixels. `orbit` sends the moon around the ring (thinking, shell, other
 * tools); `build` redraws the ring from nothing into a full circle, like the splash screen
 * (writing, editing, rewriting). Both loop until the parent stops rendering it.
 */
export function PixelLogo({ mode, size = 26 }: { mode: ActivityMode; size?: number }) {
  const ring = useMemo(buildRing, [])
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) return
    const timer = window.setInterval(() => setTick((value) => value + 1), mode === 'orbit' ? 85 : 70)
    return () => window.clearInterval(timer)
  }, [mode])

  // Orbit path: ring cells at radius ~5.8 plus the two bridging cells so the moon travels a loop.
  const orbit = useMemo(() => {
    const steps = 28
    return Array.from({ length: steps }, (_, index) => {
      const angle = (index / steps) * Math.PI * 2 - Math.PI / 2
      return { x: Math.round(CENTER + Math.cos(angle) * 5.9), y: Math.round(CENTER + Math.sin(angle) * 5.9) }
    })
  }, [])

  const BUILD_STEPS = ring.length + 12 // full ring, then a short hold with the moon, then restart
  const built = mode === 'build' ? Math.min(ring.length, tick % BUILD_STEPS) : ring.length
  const complete = mode === 'build' && tick % BUILD_STEPS >= ring.length
  const moon = mode === 'orbit' ? orbit[tick % orbit.length] : { x: 12, y: 3 }
  const showPrompt = mode === 'orbit' || built > ring.length * 0.55 || complete

  return (
    <svg
      viewBox={`0 0 ${GRID} ${GRID}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="agent-pixel-logo shrink-0"
      aria-hidden="true"
    >
      {ring.slice(0, built).map((cell, index) => (
        <rect
          key={`${cell.x}-${cell.y}`}
          x={cell.x}
          y={cell.y}
          width="1"
          height="1"
          fill={ringColor(index, ring.length)}
          opacity={mode === 'orbit' && Math.abs(index - (tick % ring.length)) < 3 ? 1 : 0.92}
        />
      ))}
      {showPrompt &&
        PROMPT.map(([x, y], index) => (
          <rect key={index} x={x} y={y} width="1" height="1" fill="#e6e9ff" opacity={index >= 5 ? 0.6 : 1} />
        ))}
      {(mode === 'orbit' || complete) && (
        <g>
          <rect x={moon.x - 0.5} y={moon.y - 0.5} width="2" height="2" fill="#ffffff" />
          <rect x={moon.x - 1} y={moon.y - 1} width="3" height="3" fill="#b9bfff" opacity="0.28" />
        </g>
      )}
    </svg>
  )
}

const EDIT_TOOLS = new Set(['write_file', 'edit_file', 'rewrite_file'])

export function activityFor(tools: ToolMessage[]): { mode: ActivityMode; label: string } {
  const running = [...tools].reverse().find((tool) => tool.status === 'running' || tool.status === 'awaiting')
  if (!running) return { mode: 'orbit', label: 'Thinking' }
  const name = running.call.name
  if (running.status === 'awaiting') return { mode: 'orbit', label: 'Waiting for you' }
  if (EDIT_TOOLS.has(name)) {
    const path = typeof running.call.args.path === 'string' ? running.call.args.path.split(/[\\/]/).pop() : ''
    const verb = name === 'write_file' ? 'Writing' : name === 'rewrite_file' ? 'Rewriting' : 'Editing'
    return { mode: 'build', label: path ? `${verb} ${path}` : verb }
  }
  if (name === 'shell') return { mode: 'orbit', label: 'Running shell' }
  return { mode: 'orbit', label: toolLabel(name) }
}

/** Shown under the turn only while the agent is working; unmounts when it finishes. */
export function AgentActivity({ tools, className }: { tools: ToolMessage[]; className?: string }) {
  const { mode, label } = activityFor(tools)
  return (
    <div className={cn('agent-activity flex items-center gap-2.5 py-1', className)} role="status" aria-live="polite">
      <PixelLogo mode={mode} />
      <span className="shimmer-text max-w-[60%] truncate text-[12.5px] font-medium">{label}…</span>
    </div>
  )
}
