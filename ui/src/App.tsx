import { useEffect } from 'react'
import { useBHiveStore } from './store/bhiveStore'
import { useWebSocket } from './hooks/useWebSocket'
import { TopBar } from './layout/TopBar'
import { Sidebar } from './layout/Sidebar'
import { OverviewPanel } from './panels/OverviewPanel'
import { AgentsPanel } from './panels/AgentsPanel'
import { ActivityFeed } from './panels/ActivityFeed'
import { ThinkingPanel } from './panels/ThinkingPanel'
import { ImprovementPanel } from './panels/ImprovementPanel'
import { GraphPanel } from './panels/GraphPanel'

export default function App() {
  useWebSocket()
  const theme = useBHiveStore((s) => s.theme)
  const activePanel = useBHiveStore((s) => s.activePanel)
  const setAgents = useBHiveStore((s) => s.setAgents)
  const setImprovementHistory = useBHiveStore((s) => s.setImprovementHistory)

  // Apply theme class
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])

  // Fetch initial agent snapshots
  useEffect(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then(setAgents)
      .catch(() => {})

    fetch('/api/improvement/memory/history')
      .then((r) => r.json())
      .then(setImprovementHistory)
      .catch(() => {})
  }, [])

  return (
    <div className="h-screen flex flex-col bg-zinc-950 dark:bg-zinc-950 light:bg-zinc-50 text-zinc-100 dark:text-zinc-100 light:text-zinc-900 overflow-hidden">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          {activePanel === 'overview' && <OverviewPanel />}
          {activePanel === 'agents' && <AgentsPanel />}
          {activePanel === 'activity' && <ActivityFeed />}
          {activePanel === 'thinking' && <ThinkingPanel />}
          {activePanel === 'improvement' && <ImprovementPanel />}
          {activePanel === 'graph' && <GraphPanel />}
        </main>
      </div>
    </div>
  )
}
