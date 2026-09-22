// =============================================================================
// src/improve/types.ts — Contracts for improvable strategy modules.
//
// A "strategy" is a self-contained slice of agent logic (memory handling,
// context building, generation, ...) exposed behind a stable interface so it
// can be evaluated, swapped, and rolled back independently of the orchestrator.
// =============================================================================

import { AgentIdentity, AgentMemory, ToolCallRecord } from "../types";

/** Optional caps a strategy may honor when trimming accumulated memory. */
export interface MemoryLimits {
  maxPosts?: number;
  maxComments?: number;
  maxNotifications?: number;
}

/**
 * Result of folding one tick's successful tool calls into memory.
 *
 * The strategy stays pure: it never touches identity/env/clock. Cooldown
 * policy remains owned by the orchestrator, which maps `postCooldownSet`
 * onto `identity.postCooldownUntil`.
 */
export interface TickMemoryPatch {
  memory: AgentMemory;
  postCooldownSet: boolean;
}

/**
 * The v2 improvable surface for the memory target.
 * Extracted verbatim from v1 logic (agentSession.buildContextPrompt +
 * orchestrator.applyToolCallsToMemory).
 */
export interface MemoryStrategy {
  /** Build the context prompt injected into a fresh per-tick Pi session. */
  buildContext(memory: AgentMemory, identity: AgentIdentity): string;

  /** Fold successful tool-call records from one tick into a new memory state. */
  applyTickToMemory(
    memory: AgentMemory,
    records: ToolCallRecord[]
  ): TickMemoryPatch;

  /** Optional: trim memory down to limits. Not implemented in baseline v1 port. */
  compact?(memory: AgentMemory, limits: MemoryLimits): AgentMemory;
}
