import { useRef, useEffect, useState } from 'react'
import { useBHiveStore } from '../store/bhiveStore'
import { BHiveEvent } from '../types'

const EVENT_COLORS: Record<string, string> = {
  'orchestrator:tick_start': 'text-zinc-400',
  'orchestrator:tick_end': 'text-zinc-500',
  'orchestrator:started': 'text-zinc-300',
  'orchestrator:paused': 'text-yellow-400',
  'orchestrator:resumed': 'text-emerald-400',
  'agent:wakeup': 'text-zinc-300',
  'agent:tool_call': 'text-zinc-400',
  'agent:tool_result': 'text-emerald-400',
  'agent:thinking': 'text-zinc-600',
  'agent:session_end': 'text-zinc-400',
  'improvement:session_start': 'text-amber-400',
  'improvement:proposal_submitted': 'text-amber-400',
  'improvement:sandbox_result': 'text-amber-300',
  'improvement:decision': 'text-amber-400',
}

function formatPayload(event: BHiveEvent): string {
  const p = event.payload as Record<string, unknown>
  switch (event.type) {
    case 'orchestrator:tick_start':
      return `tick #${p.tickIndex} — agents: ${(p.selectedAgents as Array<{ name: string }>).map((a) => a.name).join(', ')}`
    case 'orchestrator:tick_end':
      return `tick #${p.tickIndex} done — ${p.durationMs}ms`
    case 'agent:wakeup':
      return `${p.name} woke up`
    case 'agent:tool_call':
      return `${p.name} → ${p.toolName}`
    case 'agent:tool_result': {
      const isError = p.isError as boolean
      return `${p.name} ${isError ? '✗' : '✓'} ${p.toolName}`
    }
    case 'agent:thinking':
      return `${p.name}: ${String(p.text).slice(0, 80)}`
    case 'agent:session_end':
      return `${p.name} session ended (${p.toolCallCount} tool calls)`
    case 'improvement:session_start':
      return `⚡ improvement session started — target: ${p.target}`
    case 'improvement:proposal_submitted':
      return `⚡ proposal submitted — ${p.proposalId}`
    case 'improvement:sandbox_result':
      return `⚡ sandbox: ${p.verdict} — score ${((p.score as number) * 100).toFixed(0)}% (${p.passedCases}/${p.totalCases})`
    case 'improvement:decision': {
      const d = p.decision as string
      return `⚡ ${d.toUpperCase()} — ${p.message}`
    }
    default:
      return JSON.stringify(p).slice(0, 100)
  }
}

export function ActivityFeed() {
  const events = useBHiveStore((s) => s.events)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  const filters = [
    { id: 'all', label: 'all' },
    { id: 'orchestrator', label: 'orchestrator' },
    { id: 'agent', label: 'agents' },
    { id: 'improvement', label: 'improve' },
  ]

  const filtered = filter === 'all' ? events : events.filter((e) => e.type.startsWith(filter))
  const displayed = [...filtered].reverse()

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [events, autoScroll])

  return (
    <div className="h-full flex flex-col">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`text-xs px-2 py-0.5 rounded font-mono transition-colors ${
              filter === f.id
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => setAutoScroll((v) => !v)}
          className={`text-xs font-mono px-2 py-0.5 rounded transition-colors ${
            autoScroll ? 'text-amber-400' : 'text-zinc-500'
          }`}
        >
          {autoScroll ? '▼ auto-scroll' : '■ paused'}
        </button>
        <span className="text-xs font-mono text-zinc-600">{filtered.length} events</span>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto font-mono text-xs">
        {displayed.map((ev) => (
          <div
            key={ev.id}
            className="flex items-start gap-3 px-3 py-1 border-b border-zinc-800/50 hover:bg-zinc-900/50"
          >
            <span className="text-zinc-600 shrink-0 pt-0.5">
              {new Date(ev.ts).toLocaleTimeString('en-US', { hour12: false })}
            </span>
            <span className="text-zinc-700 shrink-0 pt-0.5 w-40 truncate">{ev.type}</span>
            <span className={`${EVENT_COLORS[ev.type] ?? 'text-zinc-400'} break-all`}>
              {formatPayload(ev)}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
