import { useBHiveStore } from '../store/bhiveStore'
import { BHiveEvent } from '../types'

export function ImprovementPanel() {
  const improvementActive = useBHiveStore((s) => s.improvementActive)
  const improvementHistory = useBHiveStore((s) => s.improvementHistory)
  const lastDecision = useBHiveStore((s) => s.lastDecision)
  const wsSend = useBHiveStore((s) => s.wsSend)
  const events = useBHiveStore((s) => s.events)

  const improveEvents = events.filter((e) => e.type.startsWith('improvement:'))

  const handleTrigger = () => {
    wsSend?.({ type: 'improvement:trigger', target: 'memory' })
  }

  const handleRollback = () => {
    if (confirm('Roll back memory strategy to previous version?')) {
      wsSend?.({ type: 'improvement:rollback', target: 'memory' })
    }
  }

  const decisionPayload = lastDecision?.payload as Record<string, unknown> | undefined

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Status card */}
      <div className="border border-zinc-800 rounded bg-zinc-900 p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-zinc-500">memory strategy</div>
          <div className="flex gap-2">
            <button
              onClick={handleTrigger}
              disabled={improvementActive || !wsSend}
              className="text-xs px-2.5 py-1 border border-zinc-700 rounded text-zinc-300 hover:border-amber-400 hover:text-amber-400 disabled:opacity-40 disabled:cursor-not-allowed font-mono transition-colors"
            >
              {improvementActive ? '● running…' : '▶ run now'}
            </button>
            <button
              onClick={handleRollback}
              disabled={improvementActive || !wsSend}
              className="text-xs px-2.5 py-1 border border-zinc-700 rounded text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed font-mono transition-colors"
            >
              ↩ rollback
            </button>
          </div>
        </div>

        {decisionPayload && (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-zinc-500">version</div>
              <div className="text-lg font-mono text-zinc-100">v{decisionPayload.version as number}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">baseline</div>
              <div className="text-lg font-mono text-zinc-100">{((decisionPayload.baselineScore as number) * 100).toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">last delta</div>
              <div className={`text-lg font-mono ${
                (decisionPayload.delta as number) > 0 ? 'text-emerald-400' :
                (decisionPayload.delta as number) < 0 ? 'text-red-400' : 'text-zinc-400'
              }`}>
                {(decisionPayload.delta as number) >= 0 ? '+' : ''}{((decisionPayload.delta as number) * 100).toFixed(1)}%
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Live session events */}
      {improveEvents.length > 0 && (
        <div className="border border-zinc-800 rounded bg-zinc-900">
          <div className="text-xs text-zinc-500 px-3 py-2 border-b border-zinc-800">live session</div>
          <div className="font-mono text-xs divide-y divide-zinc-800">
            {improveEvents.slice(-10).map((ev) => (
              <div key={ev.id} className="px-3 py-1.5 flex gap-3">
                <span className="text-zinc-600 shrink-0">
                  {new Date(ev.ts).toLocaleTimeString('en-US', { hour12: false })}
                </span>
                <span className="text-amber-400">{ev.type.replace('improvement:', '')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      {improvementHistory.length > 0 && (
        <div className="border border-zinc-800 rounded bg-zinc-900">
          <div className="text-xs text-zinc-500 px-3 py-2 border-b border-zinc-800">history</div>
          <div className="divide-y divide-zinc-800">
            {improvementHistory.slice(0, 20).map((h, i) => (
              <div key={i} className="px-3 py-2 flex items-start gap-3">
                <span className={`text-xs font-mono shrink-0 ${
                  h.decision === 'accepted' ? 'text-emerald-400' :
                  h.decision === 'rejected' ? 'text-red-400' :
                  h.decision === 'rollback' ? 'text-amber-400' : 'text-zinc-500'
                }`}>
                  {h.decision === 'accepted' ? '✓' : h.decision === 'rejected' ? '✗' : '↩'} v{h.version}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-zinc-400 truncate">{h.rationale}</div>
                  {h.delta !== undefined && (
                    <div className={`text-xs font-mono ${
                      h.delta > 0 ? 'text-emerald-400' : h.delta < 0 ? 'text-red-400' : 'text-zinc-500'
                    }`}>
                      {h.delta >= 0 ? '+' : ''}{(h.delta * 100).toFixed(1)}%
                    </div>
                  )}
                </div>
                <span className="text-xs text-zinc-600 font-mono shrink-0">
                  {new Date(h.timestamp).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
