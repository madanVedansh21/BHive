import { useBHiveStore } from '../store/bhiveStore'

export function TopBar() {
  const connected = useBHiveStore((s) => s.connected)
  const tickIndex = useBHiveStore((s) => s.tickIndex)
  const paused = useBHiveStore((s) => s.paused)
  const theme = useBHiveStore((s) => s.theme)
  const toggleTheme = useBHiveStore((s) => s.toggleTheme)
  const wsSend = useBHiveStore((s) => s.wsSend)

  const handlePauseResume = () => {
    if (!wsSend) return
    wsSend({ type: paused ? 'orchestrator:resume' : 'orchestrator:pause' })
  }

  return (
    <header className="h-11 border-b border-zinc-800 dark:border-zinc-800 light:border-zinc-200 flex items-center px-4 gap-4 shrink-0 bg-zinc-950 dark:bg-zinc-950 light:bg-white">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-2">
        <span className="text-amber-400 font-semibold tracking-tight text-sm">● BHive
        </span>
      </div>

      {/* Connection status */}
      <div className="flex items-center gap-1.5">
        <span className={`text-xs ${connected ? 'text-emerald-400' : 'text-zinc-500'}`}>
          ●
        </span>
        <span className="text-xs text-zinc-500 font-mono">
          {connected ? 'live' : 'reconnecting…'}
        </span>
      </div>

      {/* Tick counter */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-zinc-500">tick</span>
        <span className="text-xs font-mono text-zinc-300">#{tickIndex}</span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Pause / Resume */}
      <button
        onClick={handlePauseResume}
        disabled={!connected}
        className="text-xs px-2.5 py-1 border border-zinc-700 dark:border-zinc-700 rounded text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-mono"
      >
        {paused ? '▶ resume' : '⏸ pause'}
      </button>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="text-xs px-2.5 py-1 border border-zinc-700 dark:border-zinc-700 rounded text-zinc-400 hover:border-zinc-500 hover:text-zinc-100 transition-colors font-mono"
      >
        {theme === 'dark' ? '☀️ light' : '🌙 dark'}
      </button>
    </header>
  )
}
