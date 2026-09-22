import { useBHiveStore } from '../store/bhiveStore'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { BHiveEvent } from '../types'
import { TerminalConsole } from '../components/TerminalConsole'

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="border border-zinc-800 dark:border-zinc-800 light:border-zinc-200 rounded p-3 bg-zinc-900 dark:bg-zinc-900 light:bg-white">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className="text-xl font-mono font-medium text-zinc-100 dark:text-zinc-100 light:text-zinc-900">{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function formatEvent(event: BHiveEvent): string {
  switch (event.type) {
    case 'orchestrator:tick_start': {
      const p = event.payload as { tickIndex: number; selectedAgents: Array<{ name: string }> }
      return `tick #${p.tickIndex} — ${p.selectedAgents.length} agents woke`
    }
    case 'agent:tool_call': {
      const p = event.payload as { name: string; toolName: string }
      return `${p.name} → ${p.toolName}`
    }
    case 'agent:tool_result': {
      const p = event.payload as { name: string; toolName: string; isError: boolean }
      return `${p.name} ${p.isError ? '✗' : '✓'} ${p.toolName}`
    }
    case 'improvement:session_start':
      return '⚡ improvement session started'
    case 'improvement:decision': {
      const p = event.payload as { decision: string; version: number }
      return `⚡ improvement ${p.decision} — v${p.version}`
    }
    default:
      return event.type
  }
}

function eventColor(type: string): string {
  if (type.startsWith('orchestrator:')) return 'text-zinc-400'
  if (type.startsWith('agent:tool_result')) return 'text-emerald-400'
  if (type.includes('error') || type.includes('CRASH')) return 'text-red-400'
  if (type.startsWith('improvement:')) return 'text-amber-400'
  return 'text-zinc-400'
}

export function OverviewPanel() {
  const agents = useBHiveStore((s) => s.agents)
  const tickIndex = useBHiveStore((s) => s.tickIndex)
  const tickHistory = useBHiveStore((s) => s.tickHistory)
  const events = useBHiveStore((s) => s.events)
  const config = useBHiveStore((s) => s.config)
  const paused = useBHiveStore((s) => s.paused)
  const improvementActive = useBHiveStore((s) => s.improvementActive)

  const recentEvents = [...events].reverse().slice(0, 12)

  const chartData = tickHistory.map((t) => ({
    name: `#${t.tickIndex}`,
    ms: t.durationMs,
  }))

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Agents" value={agents.length} />
        <StatCard label="Tick" value={`#${tickIndex}`} />
        <StatCard
          label="Orchestrator"
          value={paused ? 'paused' : 'running'}
          sub={config ? `${config.tickIntervalMs / 1000}s interval` : undefined}
        />
        <StatCard
          label="Improvement"
          value={improvementActive ? '● active' : config?.improvementEnabled ? 'on cadence' : 'off'}
        />
      </div>

      {/* Tick timeline */}
      {chartData.length > 0 && (
        <div className="border border-zinc-800 rounded p-3 bg-zinc-900">
          <div className="text-xs text-zinc-500 mb-3">tick duration (ms) — last {chartData.length} ticks</div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={chartData} barSize={8}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip
                contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 4, fontSize: 11 }}
                labelStyle={{ color: '#a1a1aa' }}
                cursor={{ fill: '#27272a' }}
              />
              <Bar dataKey="ms" fill="#F59E0B" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent events */}
      <div className="border border-zinc-800 rounded bg-zinc-900">
        <div className="text-xs text-zinc-500 px-3 py-2 border-b border-zinc-800">recent events</div>
        <div className="divide-y divide-zinc-800">
          {recentEvents.length === 0 && (
            <div className="px-3 py-3 text-xs text-zinc-600 font-mono">waiting for orchestrator…</div>
          )}
          {recentEvents.map((ev) => (
            <div key={ev.id} className="flex items-start gap-3 px-3 py-1.5">
              <span className="text-xs font-mono text-zinc-600 shrink-0 pt-0.5">
                {new Date(ev.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className={`text-xs font-mono ${eventColor(ev.type)}`}>
                {formatEvent(ev)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Terminal Console */}
      <TerminalConsole defaultOpen={false} />
    </div>
  )
}
