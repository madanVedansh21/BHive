import { useEffect, useRef } from 'react'
import { useBHiveStore } from '../store/bhiveStore'

export function ThinkingPanel() {
  const agents = useBHiveStore((s) => s.agents)
  const thinkingMap = useBHiveStore((s) => s.thinkingMap)
  const selectedAgentId = useBHiveStore((s) => s.selectedAgentId)
  const setSelectedAgentId = useBHiveStore((s) => s.setSelectedAgentId)
  const bottomRef = useRef<HTMLDivElement>(null)

  const activeEntry = selectedAgentId ? thinkingMap[selectedAgentId] : null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeEntry?.chunks.length, activeEntry?.toolCalls.length])

  return (
    <div className="h-full flex flex-col">
      {/* Agent selector */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-xs text-zinc-500">agent:</span>
        <select
          value={selectedAgentId ?? ''}
          onChange={(e) => setSelectedAgentId(e.target.value || null)}
          className="bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 px-2 py-0.5 font-mono"
        >
          <option value="">select agent…</option>
          {agents.map((a) => (
            <option key={a.agentId} value={a.agentId}>{a.name}</option>
          ))}
        </select>
        {activeEntry && (
          <span className="text-xs font-mono text-zinc-500 ml-2">
            tick #{activeEntry.tickIndex} — {activeEntry.ended ? '✓ done' : <span className="text-amber-400">● live</span>}
          </span>
        )}
      </div>

      {/* Thinking stream */}
      <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1">
        {!activeEntry && (
          <div className="text-zinc-600 py-8 text-center">select an agent to watch its thinking</div>
        )}

        {activeEntry && (
          <>
            {/* Render interleaved thinking chunks and tool calls */}
            {activeEntry.chunks.map((chunk, i) => (
              <span key={`chunk-${i}`} className="text-zinc-300 whitespace-pre-wrap">{chunk}</span>
            ))}
            {activeEntry.toolCalls.map((tc, i) => (
              <div key={`tool-${i}`} className="mt-2 mb-1">
                <div className="flex items-center gap-2">
                  <span className={`${tc.isError ? 'text-red-400' : 'text-emerald-400'}`}>
                    [{tc.isError ? '✗' : '✓'} {tc.toolName}]
                  </span>
                </div>
                <div className="pl-4 text-zinc-600">
                  args: {JSON.stringify(tc.args).slice(0, 120)}
                </div>
                {tc.result !== null && (
                  <div className="pl-4 text-zinc-700">
                    result: {JSON.stringify(tc.result).slice(0, 120)}
                  </div>
                )}
              </div>
            ))}
            {!activeEntry.ended && (
              <span className="text-amber-400 animate-pulse">█</span>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
