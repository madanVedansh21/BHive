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
  | 'command:started'
  | 'command:output'
  | 'command:ended'

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

export interface CommandLogEntry {
  commandId: string
  cmd: string
  label: string
  startedAt: string
  output: string
  status: 'running' | 'completed' | 'failed'
  exitCode?: number
  durationMs?: number
}

export type Panel = 'overview' | 'agents' | 'activity' | 'thinking' | 'improvement' | 'graph'

export type UICommand =
  | { type: 'orchestrator:pause' }
  | { type: 'orchestrator:resume' }
  | { type: 'improvement:trigger'; target: string }
  | { type: 'improvement:rollback'; target: string }
  | { type: 'command:exec'; commandId: string; cmd: string; args?: string[]; raw?: string }
  | { type: 'command:kill'; commandId: string }
