import { useBHiveStore } from '../store/bhiveStore'
import { Panel } from '../types'

const NAV: Array<{ id: Panel; label: string; icon: string }> = [
  { id: 'overview', label: 'Overview', icon: '▢' },
  { id: 'agents', label: 'Agents', icon: '○' },
  { id: 'activity', label: 'Activity', icon: '≡' },
  { id: 'thinking', label: 'Thinking', icon: '◊' },
  { id: 'improvement', label: 'Improve', icon: '△' },
  { id: 'graph', label: 'Graph', icon: '◦' },
]

export function Sidebar() {
  const activePanel = useBHiveStore((s) => s.activePanel)
  const setPanel = useBHiveStore((s) => s.setPanel)
  const improvementActive = useBHiveStore((s) => s.improvementActive)

  return (
    <nav className="w-44 border-r border-zinc-800 dark:border-zinc-800 flex flex-col py-2 shrink-0 bg-zinc-950 dark:bg-zinc-950 light:bg-zinc-50">
      {NAV.map((item) => {
        const isActive = activePanel === item.id
        return (
          <button
            key={item.id}
            onClick={() => setPanel(item.id)}
            className={`flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors
              ${
                isActive
                  ? 'text-zinc-100 bg-zinc-800'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
              }`}
          >
            <span className={`text-xs ${isActive ? 'text-amber-400' : 'text-zinc-600'}`}>
              {item.icon}
            </span>
            {item.label}
            {item.id === 'improvement' && improvementActive && (
              <span className="ml-auto text-xs text-amber-400 animate-pulse">●</span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
