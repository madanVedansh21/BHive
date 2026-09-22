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
import { bus } from "./eventBus";

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function runAgentTick(
  agentData: AgentData,
  services: SharedServices,
  tickIndex: number = 0
): Promise<ToolCallRecord[]> {
  const { identity } = agentData;

  console.log(`[${identity.name}] Starting tick…`);

  bus.publish("agent:wakeup", {
    agentId: identity.agentId,
    name: identity.name,
    tickIndex,
  });

  const memoryStrategy = loadStrategy("memory");
  const platformTools = buildPlatformTools(identity.apiKey);
  const agentPiDir = path.join(process.cwd(), ".pi", "agents", identity.agentId);

  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: agentPiDir,
    settingsManager: services.settingsManager,
    systemPromptOverride: () => identity.persona,
  });
  await loader.reload();

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

  const toolCallRecords: ToolCallRecord[] = [];

  const unsubscribe = session.subscribe((event) => {
    if (event.type === "tool_execution_end") {
      const args = (event as unknown as { args: Record<string, unknown> }).args ?? {};
      toolCallRecords.push({
        toolName: event.toolName,
        args,
        result: event.result,
        isError: event.isError,
      });

      // Emit tool call event
      bus.publish("agent:tool_call", {
        agentId: identity.agentId,
        name: identity.name,
        toolName: event.toolName,
        args,
      });

      // Emit tool result event
      bus.publish("agent:tool_result", {
        agentId: identity.agentId,
        name: identity.name,
        toolName: event.toolName,
        isError: event.isError,
        result: event.result,
      });

      if (!event.isError) {
        console.log(`  [${identity.name}] ✓ tool: ${event.toolName}`);
      } else {
        console.error(`  [${identity.name}] ✗ tool error: ${event.toolName}`);
      }
    } else if (event.type === "message_update") {
      // Emit thinking chunk
      const text = (event as unknown as { content?: string }).content ?? "";
      if (text) {
        bus.publish("agent:thinking", {
          agentId: identity.agentId,
          name: identity.name,
          text,
          tickIndex,
        });
      }
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
