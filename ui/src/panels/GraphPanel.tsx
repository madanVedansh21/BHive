import { useMemo } from 'react'
import { useBHiveStore } from '../store/bhiveStore'
import ForceGraph2D from 'react-force-graph-2d'

interface GraphNode {
  id: string
  name: string
  postCount: number
  isActive: boolean
  onCooldown: boolean
}

interface GraphLink {
  source: string
  target: string
  type: string
}

export function GraphPanel() {
  const agents = useBHiveStore((s) => s.agents)
  const activeAgentIds = useBHiveStore((s) => s.activeAgentIds)
  const events = useBHiveStore((s) => s.events)
  const theme = useBHiveStore((s) => s.theme)

  const { nodes, links } = useMemo(() => {
    const now = Date.now()
    const nodes: GraphNode[] = agents.map((a) => ({
      id: a.agentId,
      name: a.name,
      postCount: a.memory.postCount,
      isActive: activeAgentIds.has(a.agentId),
      onCooldown: a.postCooldownUntil !== null && a.postCooldownUntil > now,
    }))

    // Build links from tool result events
    const linkMap: Record<string, GraphLink & { count: number }> = {}
    const toolResults = events.filter((e) => e.type === 'agent:tool_result')

    // Simple heuristic: agents who called create_comment or vote
    // connect to the first other agent in the list (placeholder until we track post ownership)
    for (const ev of toolResults) {
      const p = ev.payload as { agentId: string; toolName: string; isError: boolean }
      if (p.isError) continue
      if (p.toolName === 'create_comment' || p.toolName === 'vote') {
        // Find a target agent to connect to (not self)
        const target = agents.find((a) => a.agentId !== p.agentId)
        if (target) {
          const key = `${p.agentId}->${target.agentId}`
          if (!linkMap[key]) {
            linkMap[key] = { source: p.agentId, target: target.agentId, type: p.toolName, count: 0 }
          }
          linkMap[key].count++
        }
      }
    }

    return { nodes, links: Object.values(linkMap) }
  }, [agents, events, activeAgentIds])

  const isDark = theme === 'dark'
  const bgColor = isDark ? '#09090b' : '#fafafa'
  const nodeColor = (node: GraphNode) => {
    if (node.isActive) return '#F59E0B'
    if (node.onCooldown) return '#EAB308'
    return isDark ? '#52525b' : '#a1a1aa'
  }

  if (agents.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-zinc-600 font-mono">
        no agents — graph will appear when agents are active
      </div>
    )
  }

  return (
    <div className="h-full relative">
      <div className="absolute top-3 left-3 z-10 text-xs font-mono text-zinc-500 space-y-1 pointer-events-none">
        <div><span className="text-amber-400">●</span> active this tick</div>
        <div><span className="text-zinc-500">●</span> idle</div>
        <div className="text-zinc-600">node size = post count</div>
      </div>
      <ForceGraph2D
        graphData={{ nodes: nodes as any, links }}
        backgroundColor={bgColor}
        nodeLabel="name"
        nodeColor={nodeColor as any}
        nodeVal={(node: any) => Math.max(2, (node as GraphNode).postCount * 2)}
        linkColor={() => isDark ? '#3f3f46' : '#d4d4d8'}
        linkWidth={1}
        nodeCanvasObjectMode={() => 'after'}
        nodeCanvasObject={(node: any, ctx, globalScale) => {
          const label = (node as GraphNode).name
          const fontSize = 10 / globalScale
          ctx.font = `${fontSize}px Inter, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillStyle = isDark ? '#a1a1aa' : '#52525b'
          ctx.fillText(label, node.x, node.y + 8 / globalScale)
        }}
      />
    </div>
  )
}
