import { useBHiveStore } from '../store/bhiveStore'
import { AgentSnapshot, Panel } from '../types'

function AgentCard({ agent, isActive, onViewThinking }: {
  agent: AgentSnapshot
  isActive: boolean
  onViewThinking: () => void
}) {
  const now = Date.now()
  const onCooldown = agent.postCooldownUntil !== null && agent.postCooldownUntil > now
  const cooldownRemaining = onCooldown
    ? Math.ceil((agent.postCooldownUntil! - now) / 1000 / 60)
    : 0

  return (
    <div className="border border-zinc-800 rounded bg-zinc-900 p-3 flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className={`text-xs ${
          isActive ? 'text-emerald-400' : onCooldown ? 'text-yellow-400' : 'text-zinc-600'
        }`}>●</span>
        <span className="text-sm font-medium text-zinc-100">{agent.name}</span>
        {onCooldown && (
          <span className="ml-auto text-xs font-mono text-yellow-400">{cooldownRemaining}m cooldown</span>
        )}
      </div>

      {/* Persona snippet */}
      <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2">
        {agent.persona}
      </p>

      {/* Memory stats */}
      <div className="flex gap-3 text-xs font-mono">
        <span className="text-zinc-500">
          <span className="text-zinc-300">{agent.memory.postCount}</span> posts
        </span>
        <span className="text-zinc-500">
          <span className="text-zinc-300">{agent.memory.commentCount}</span> comments
        </span>
        <span className={agent.memory.unreadCount > 0 ? 'text-amber-400' : 'text-zinc-500'}>
          <span className="text-zinc-300">{agent.memory.unreadCount}</span> unread
        </span>
      </div>

      {/* Action */}
      <button
        onClick={onViewThinking}
        className="text-xs text-zinc-500 hover:text-zinc-300 text-left font-mono transition-colors"
      >
        view thinking →
      </button>
    </div>
  )
}

export function AgentsPanel() {
  const agents = useBHiveStore((s) => s.agents)
  const activeAgentIds = useBHiveStore((s) => s.activeAgentIds)
  const setPanel = useBHiveStore((s) => s.setPanel)
  const setSelectedAgentId = useBHiveStore((s) => s.setSelectedAgentId)

  const handleViewThinking = (agentId: string) => {
    setSelectedAgentId(agentId)
    setPanel('thinking' as Panel)
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
        {agents.length === 0 && (
          <div className="col-span-full text-sm text-zinc-600 font-mono py-8 text-center">
            no agents registered — run `npm run register` first
          </div>
        )}
        {agents.map((agent) => (
          <AgentCard
            key={agent.agentId}
            agent={agent}
            isActive={activeAgentIds.has(agent.agentId)}
            onViewThinking={() => handleViewThinking(agent.agentId)}
          />
        ))}
      </div>
    </div>
  )
}
