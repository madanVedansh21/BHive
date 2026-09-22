import { create } from 'zustand'
import { BHiveEvent, AgentSnapshot, Panel, InteractionEdge } from '../types'

interface OrchestratorConfig {
  tickIntervalMs: number
  agentsPerTick: number
  improvementEnabled: boolean
  platformBaseUrl: string
}

interface TickRecord {
  tickIndex: number
  durationMs: number
  agentCount: number
  ts: string
}

interface ImprovementHistory {
  timestamp: string
  decision: string
  version: number
  baseline: number
  candidate?: number
  delta?: number
  rationale: string
}

interface ThinkingEntry {
  agentId: string
  name: string
  tickIndex: number
  chunks: string[]
  toolCalls: Array<{ toolName: string; args: Record<string, unknown>; isError: boolean; result: unknown }>
  ended: boolean
}

interface BHiveState {
  // Connection
  connected: boolean
  setConnected: (v: boolean) => void

  // Theme
  theme: 'dark' | 'light'
  toggleTheme: () => void

  // Panel
  activePanel: Panel
  setPanel: (p: Panel) => void

  // Orchestrator
  config: OrchestratorConfig | null
  paused: boolean
  tickIndex: number
  tickHistory: TickRecord[]

  // Agents
  agents: AgentSnapshot[]
  setAgents: (agents: AgentSnapshot[]) => void
  activeAgentIds: Set<string> // active this tick

  // Activity feed
  events: BHiveEvent[]

  // Thinking
  selectedAgentId: string | null
  setSelectedAgentId: (id: string | null) => void
  thinkingMap: Record<string, ThinkingEntry> // keyed by agentId

  // Improvement
  improvementActive: boolean
  improvementHistory: ImprovementHistory[]
  setImprovementHistory: (h: ImprovementHistory[]) => void
  lastDecision: BHiveEvent | null

  // Interaction graph
  interactions: InteractionEdge[]

  // WebSocket send
  wsSend: ((msg: object) => void) | null
  setWsSend: (fn: (msg: object) => void) => void

  // Main event handler
  handleEvent: (event: BHiveEvent) => void
}

const MAX_EVENTS = 500
const MAX_TICK_HISTORY = 30

export const useBHiveStore = create<BHiveState>((set, get) => ({
  connected: false,
  setConnected: (v) => set({ connected: v }),

  theme: 'dark',
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    set({ theme: next })
    document.documentElement.classList.toggle('dark', next === 'dark')
    document.documentElement.classList.toggle('light', next === 'light')
  },

  activePanel: 'overview',
  setPanel: (p) => set({ activePanel: p }),

  config: null,
  paused: false,
  tickIndex: 0,
  tickHistory: [],

  agents: [],
  setAgents: (agents) => set({ agents }),
  activeAgentIds: new Set(),

  events: [],

  selectedAgentId: null,
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),
  thinkingMap: {},

  improvementActive: false,
  improvementHistory: [],
  setImprovementHistory: (h) => set({ improvementHistory: h }),
  lastDecision: null,

  interactions: [],

  wsSend: null,
  setWsSend: (fn) => set({ wsSend: fn }),

  handleEvent: (event) => {
    set((state) => {
      const events = [...state.events, event].slice(-MAX_EVENTS)

      switch (event.type) {
        case 'orchestrator:started': {
          const p = event.payload as OrchestratorConfig
          return { events, config: p, paused: false }
        }
        case 'orchestrator:tick_start': {
          const p = event.payload as { tickIndex: number; selectedAgents: Array<{ agentId: string }> }
          return {
            events,
            tickIndex: p.tickIndex,
            activeAgentIds: new Set(p.selectedAgents.map((a) => a.agentId)),
          }
        }
        case 'orchestrator:tick_end': {
          const p = event.payload as { tickIndex: number; durationMs: number }
          const newRecord: TickRecord = {
            tickIndex: p.tickIndex,
            durationMs: p.durationMs,
            agentCount: state.activeAgentIds.size,
            ts: event.ts,
          }
          const tickHistory = [...state.tickHistory, newRecord].slice(-MAX_TICK_HISTORY)
          return { events, tickHistory, activeAgentIds: new Set() }
        }
        case 'orchestrator:paused':
          return { events, paused: true }
        case 'orchestrator:resumed':
          return { events, paused: false }
        case 'agent:wakeup': {
          const p = event.payload as { agentId: string; name: string; tickIndex: number }
          const thinkingMap = { ...state.thinkingMap }
          thinkingMap[p.agentId] = {
            agentId: p.agentId,
            name: p.name,
            tickIndex: p.tickIndex,
            chunks: [],
            toolCalls: [],
            ended: false,
          }
          return { events, thinkingMap }
        }
        case 'agent:thinking': {
          const p = event.payload as { agentId: string; text: string }
          const thinkingMap = { ...state.thinkingMap }
          if (thinkingMap[p.agentId]) {
            thinkingMap[p.agentId] = {
              ...thinkingMap[p.agentId],
              chunks: [...thinkingMap[p.agentId].chunks, p.text],
            }
          }
          return { events, thinkingMap }
        }
        case 'agent:tool_call': {
          const p = event.payload as { agentId: string; toolName: string; args: Record<string, unknown> }
          const thinkingMap = { ...state.thinkingMap }
          if (thinkingMap[p.agentId]) {
            thinkingMap[p.agentId] = {
              ...thinkingMap[p.agentId],
              toolCalls: [...thinkingMap[p.agentId].toolCalls, { toolName: p.toolName, args: p.args, isError: false, result: null }],
            }
          }
          return { events, thinkingMap }
        }
        case 'agent:tool_result': {
          const p = event.payload as { agentId: string; toolName: string; isError: boolean; result: unknown }
          const thinkingMap = { ...state.thinkingMap }
          if (thinkingMap[p.agentId]) {
            const calls = [...thinkingMap[p.agentId].toolCalls]
            // update last matching tool call
            for (let i = calls.length - 1; i >= 0; i--) {
              if (calls[i].toolName === p.toolName) {
                calls[i] = { ...calls[i], isError: p.isError, result: p.result }
                break
              }
            }
            thinkingMap[p.agentId] = { ...thinkingMap[p.agentId], toolCalls: calls }
          }
          // Build interaction edges for graph
          if (!p.isError && (p.toolName === 'create_comment' || p.toolName === 'vote')) {
            // We'll add edges when we know who owns the post
            // For now store raw events for graph building
          }
          return { events, thinkingMap }
        }
        case 'agent:session_end': {
          const p = event.payload as { agentId: string }
          const thinkingMap = { ...state.thinkingMap }
          if (thinkingMap[p.agentId]) {
            thinkingMap[p.agentId] = { ...thinkingMap[p.agentId], ended: true }
          }
          return { events, thinkingMap }
        }
        case 'improvement:session_start':
          return { events, improvementActive: true }
        case 'improvement:decision': {
          return { events, improvementActive: false, lastDecision: event }
        }
        default:
          return { events }
      }
    })
  },
}))
