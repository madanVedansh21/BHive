import { useState, useRef, useEffect } from 'react'
import { useBHiveStore } from '../store/bhiveStore'

const PRESETS = [
  { label: '🧪 Run Eval', cmd: 'eval', desc: 'Deterministic 10-case ground truth test harness' },
  { label: '👥 Register 5', cmd: 'register', args: ['5'], desc: 'Register 5 new personas on platform' },
  { label: '🧠 Run Improve', cmd: 'improve', desc: 'Autonomous introspection & self-refinement cycle' },
  { label: '↩ Rollback', cmd: 'rollback', args: ['memory'], desc: 'Revert memory strategy to previous version' },
]

export function TerminalConsole({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const [inputVal, setInputVal] = useState('')
  const [selectedCommandId, setSelectedCommandId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const commands = useBHiveStore((s) => s.commands)
  const activeCommandId = useBHiveStore((s) => s.activeCommandId)
  const executeCommand = useBHiveStore((s) => s.executeCommand)
  const killCommand = useBHiveStore((s) => s.killCommand)
  const clearCommands = useBHiveStore((s) => s.clearCommands)
  const connected = useBHiveStore((s) => s.connected)

  // Current command being viewed (default to active or newest)
  const currentCmd = selectedCommandId
    ? commands.find((c) => c.commandId === selectedCommandId)
    : commands[0]

  useEffect(() => {
    if (activeCommandId && !selectedCommandId) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [currentCmd?.output, activeCommandId, selectedCommandId])

  const handleRunPreset = (preset: typeof PRESETS[number]) => {
    executeCommand(preset.cmd, preset.args)
    setSelectedCommandId(null)
    setIsOpen(true)
  }

  const handleRunCustom = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = inputVal.trim()
    if (!trimmed) return

    // Quick parse: if user typed "eval", "register", "improve", etc.
    const parts = trimmed.split(/\s+/)
    const first = parts[0].toLowerCase()

    if (first === 'eval') {
      executeCommand('eval')
    } else if (first === 'register') {
      executeCommand('register', parts.slice(1))
    } else if (first === 'improve') {
      executeCommand('improve')
    } else if (first === 'rollback') {
      executeCommand('rollback', parts.slice(1))
    } else {
      executeCommand('custom', [], trimmed)
    }

    setInputVal('')
    setSelectedCommandId(null)
    setIsOpen(true)
  }

  return (
    <div className="border border-zinc-800 rounded bg-zinc-950 flex flex-col shrink-0 font-mono text-xs">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-900/60">
        <span className="text-zinc-400 font-medium">terminal & commands</span>

        {activeCommandId && (
          <span className="flex items-center gap-1.5 ml-2 text-amber-400 font-mono">
            <span className="animate-pulse">●</span>
            <span>running...</span>
          </span>
        )}

        <div className="flex-1" />

        {/* Quick action preset chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {PRESETS.map((p) => (
            <button
              key={p.cmd}
              onClick={() => handleRunPreset(p)}
              disabled={!connected || !!activeCommandId}
              title={p.desc}
              className="px-2 py-0.5 border border-zinc-800 hover:border-zinc-600 rounded text-zinc-300 hover:text-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-[11px]"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Toggle open/close */}
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="ml-2 text-zinc-500 hover:text-zinc-300 px-1.5 py-0.5 transition-colors"
        >
          {isOpen ? '▲ hide' : '▼ console'}
        </button>
      </div>

      {isOpen && (
        <div className="flex flex-col">
          {/* Active / History selector & Controls */}
          {commands.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/80 bg-zinc-900/30 text-[11px]">
              <span className="text-zinc-500">history:</span>
              <select
                value={currentCmd?.commandId ?? ''}
                onChange={(e) => setSelectedCommandId(e.target.value || null)}
                className="bg-zinc-800 border border-zinc-700 rounded text-zinc-200 px-1.5 py-0.5 text-[11px] max-w-xs truncate"
              >
                {commands.map((c) => (
                  <option key={c.commandId} value={c.commandId}>
                    {c.status === 'running' ? '● ' : c.status === 'completed' ? '✓ ' : '✗ '}
                    {c.label} ({new Date(c.startedAt).toLocaleTimeString()})
                  </option>
                ))}
              </select>

              {currentCmd && (
                <span
                  className={`ml-1 text-[11px] ${
                    currentCmd.status === 'running'
                      ? 'text-amber-400'
                      : currentCmd.status === 'completed'
                      ? 'text-emerald-400'
                      : 'text-red-400'
                  }`}
                >
                  {currentCmd.status}
                  {currentCmd.durationMs !== undefined && ` (${(currentCmd.durationMs / 1000).toFixed(1)}s)`}
                </span>
              )}

              <div className="flex-1" />

              {activeCommandId && (
                <button
                  onClick={() => killCommand(activeCommandId)}
                  className="px-2 py-0.5 border border-red-800/80 bg-red-950/30 text-red-400 hover:bg-red-900/40 rounded transition-colors text-[11px]"
                >
                  ■ cancel process
                </button>
              )}

              <button
                onClick={clearCommands}
                className="text-zinc-500 hover:text-zinc-300 px-1.5 py-0.5 transition-colors text-[11px]"
              >
                clear
              </button>
            </div>
          )}

          {/* Terminal output window */}
          <div className="h-48 overflow-y-auto p-3 bg-zinc-950 font-mono text-xs space-y-1 select-text">
            {!currentCmd && (
              <div className="text-zinc-600 py-6 text-center">
                Click a preset button above or type a command below to execute.
              </div>
            )}

            {currentCmd && (
              <>
                <div className="text-zinc-500 pb-1 border-b border-zinc-900">
                  <span className="text-amber-400">$</span> {currentCmd.label}
                </div>
                <pre className="text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">
                  {currentCmd.output || (currentCmd.status === 'running' ? 'Executing…' : '(no output)')}
                </pre>
                {currentCmd.status === 'running' && (
                  <span className="inline-block w-2 h-3.5 bg-amber-400 animate-pulse ml-0.5 align-middle" />
                )}
                {currentCmd.status !== 'running' && (
                  <div className="text-zinc-600 pt-1 text-[10px]">
                    Process exited with code {currentCmd.exitCode ?? 0} in{' '}
                    {currentCmd.durationMs !== undefined ? `${(currentCmd.durationMs / 1000).toFixed(2)}s` : '0s'}
                  </div>
                )}
              </>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Interactive prompt input bar */}
          <form
            onSubmit={handleRunCustom}
            className="flex items-center gap-2 px-3 py-2 border-t border-zinc-800 bg-zinc-900/40"
          >
            <span className="text-amber-400 font-bold select-none">&gt;</span>
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="type command (e.g. eval, register 5, improve, rollback, npm run build)…"
              disabled={!connected || !!activeCommandId}
              className="flex-1 bg-transparent text-zinc-200 placeholder:text-zinc-600 focus:outline-none text-xs"
            />
            <button
              type="submit"
              disabled={!connected || !inputVal.trim() || !!activeCommandId}
              className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-200 rounded text-xs transition-colors"
            >
              Run ▶
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
