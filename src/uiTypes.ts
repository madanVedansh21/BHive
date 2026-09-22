// =============================================================================
// src/uiTypes.ts — Typed event contracts for the BHive real-time UI daemon.
//
// All events share the BHiveEvent<T> envelope and are emitted on eventBus.
// The WebSocket server fans them out to all connected browser clients.
// =============================================================================

export type BHiveEventType =
  | "orchestrator:started"
  | "orchestrator:tick_start"
  | "orchestrator:tick_end"
  | "orchestrator:paused"
  | "orchestrator:resumed"
  | "agent:wakeup"
  | "agent:tool_call"
  | "agent:tool_result"
  | "agent:thinking"
  | "agent:session_end"
  | "improvement:session_start"
  | "improvement:proposal_submitted"
  | "improvement:sandbox_result"
  | "improvement:decision";

export interface BHiveEvent<T = unknown> {
  id: string;
  ts: string;
  type: BHiveEventType;
  payload: T;
}

// ---------------------------------------------------------------------------
// Payload shapes per event type
// ---------------------------------------------------------------------------

export interface OrchestratorStartedPayload {
  tickIntervalMs: number;
  agentsPerTick: number;
  concurrencyLimit: number;
  improvementEnabled: boolean;
  improveCadenceTicks: number;
  platformBaseUrl: string;
}

export interface OrchestratorTickStartPayload {
  tickIndex: number;
  selectedAgents: Array<{ agentId: string; name: string }>;
  eligibleCount: number;
  totalCount: number;
}

export interface OrchestratorTickEndPayload {
  tickIndex: number;
  durationMs: number;
}

export interface AgentWakeupPayload {
  agentId: string;
  name: string;
  tickIndex: number;
}

export interface AgentToolCallPayload {
  agentId: string;
  name: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface AgentToolResultPayload {
  agentId: string;
  name: string;
  toolName: string;
  isError: boolean;
  result: unknown;
}

export interface AgentThinkingPayload {
  agentId: string;
  name: string;
  text: string;
  tickIndex: number;
}

export interface AgentSessionEndPayload {
  agentId: string;
  name: string;
  tickIndex: number;
  toolCallCount: number;
  memory: import("./types").AgentMemory;
}

export interface ImprovementSessionStartPayload {
  target: string;
}

export interface ImprovementProposalSubmittedPayload {
  proposalId: string;
  target: string;
  rationale: string;
}

export interface ImprovementSandboxResultPayload {
  proposalId: string;
  verdict: string;
  score: number;
  passedCases: number;
  totalCases: number;
  errorMessage?: string;
}

export interface ImprovementDecisionPayload {
  decision: "accepted" | "rejected" | "held_for_review";
  target: string;
  version: number;
  baselineScore: number;
  candidateScore: number;
  delta: number;
  rationale: string;
  message: string;
}

// ---------------------------------------------------------------------------
// WebSocket message types (client → server commands)
// ---------------------------------------------------------------------------

export type UICommand =
  | { type: "orchestrator:pause" }
  | { type: "orchestrator:resume" }
  | { type: "improvement:trigger"; target: string }
  | { type: "improvement:rollback"; target: string };
