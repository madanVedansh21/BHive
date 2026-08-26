// =============================================================================
// src/agentSession.ts — Per-agent Pi session factory.
//
// runAgentTick():
//   1. Builds platform tools closed over agent's apiKey
//   2. Creates a fresh (in-memory) Pi session for this single tick
//   3. Builds a context prompt from persona + memory + notifications
//   4. Calls session.prompt(), awaits completion
//   5. Returns ToolCallRecord[] for the orchestrator to update memory
// =============================================================================

import * as path from "path";
import {
  createAgentSession,
  SessionManager,
  DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { AgentData, SharedServices, ToolCallRecord } from "./types.js";
import { buildPlatformTools, PLATFORM_TOOL_NAMES } from "./platformTools.js";
import { loadStrategy } from "./improve/registry.js";

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function runAgentTick(
  agentData: AgentData,
  services: SharedServices
): Promise<ToolCallRecord[]> {
  const { identity } = agentData;

  console.log(`[${identity.name}] Starting tick…`);

  // Loaded per tick so an accepted improvement swap is picked up next wake-up
  const memoryStrategy = loadStrategy("memory");

  const platformTools = buildPlatformTools(identity.apiKey);

  // Per-agent Pi dir (for session files if they persist)
  const agentPiDir = path.join(process.cwd(), ".pi", "agents", identity.agentId);

  // Build resource loader with dynamic persona-based system prompt
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: agentPiDir,
    settingsManager: services.settingsManager,
    systemPromptOverride: () => identity.persona,
  });
  await loader.reload();

  // Fresh in-memory session per tick — no cross-tick context leakage
  const sessionManager = SessionManager.inMemory();

  const { session } = await createAgentSession({
    cwd: process.cwd(),
    agentDir: agentPiDir,
    model: services.model,
    thinkingLevel: "low",
    authStorage: services.authStorage,
    modelRegistry: services.modelRegistry,
    tools: [...PLATFORM_TOOL_NAMES],
    customTools: platformTools,
    resourceLoader: loader,
    sessionManager,
    settingsManager: services.settingsManager,
  });

  // Collect tool call results during the session
  const toolCallRecords: ToolCallRecord[] = [];

  const unsubscribe = session.subscribe((event) => {
    if (event.type === "tool_execution_end") {
      toolCallRecords.push({
        toolName: event.toolName,
        args: (event as unknown as { args: Record<string, unknown> }).args ?? {},
        result: event.result,
        isError: event.isError,
      });
      if (!event.isError) {
        console.log(`  [${identity.name}] ✓ tool: ${event.toolName}`);
      } else {
        console.error(`  [${identity.name}] ✗ tool error: ${event.toolName}`);
      }
    } else if (event.type === "message_update") {
      // Silent — no stdout noise during orchestration
    } else if (event.type === "agent_end") {
      console.log(`  [${identity.name}] Session ended.`);
    }
  });

  try {
    const contextPrompt = memoryStrategy.buildContext(agentData.memory, identity);
    await session.prompt(contextPrompt);
  } finally {
    unsubscribe();
    session.dispose();
  }

  return toolCallRecords;
}
