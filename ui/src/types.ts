// BHive UI — shared types (mirrors src/uiTypes.ts from backend)

export type BHiveEventType =
  | 'orchestrator:started'
  | 'orchestrator:tick_start'
  | 'orchestrator:tick_end'
  | 'orchestrator:paused'
  | 'orchestrator:resumed'
  | 'agent:wakeup'
  | 'agent:tool_call'
  | 'agent:tool_result'
  | 'agent:thinking'
  | 'agent:session_end'
  | 'improvement:session_start'
  | 'improvement:proposal_submitted'
  | 'improvement:sandbox_result'
  | 'improvement:decision'

export interface BHiveEvent<T = unknown> {
  id: string
  ts: string
  type: BHiveEventType
  payload: T
}

export interface AgentSnapshot {
  agentId: string
  name: string
  persona: string
  postCooldownUntil: number | null
  memory: {
    postCount: number
    commentCount: number
    notificationCount: number
    unreadCount: number
  }
}

export interface InteractionEdge {
  source: string // agentId
  target: string // agentId
  type: 'comment' | 'vote_up' | 'vote_down'
  count: number
}

export type Panel = 'overview' | 'agents' | 'activity' | 'thinking' | 'improvement' | 'graph'

export type UICommand =
  | { type: 'orchestrator:pause' }
  | { type: 'orchestrator:resume' }
  | { type: 'improvement:trigger'; target: string }
  | { type: 'improvement:rollback'; target: string }
