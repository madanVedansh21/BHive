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

// ---------------------------------------------------------------------------
// Context prompt builder
// ---------------------------------------------------------------------------

function buildContextPrompt(agentData: AgentData): string {
  const { identity, memory } = agentData;

  const recentPosts = memory.postedByMe.slice(-5);
  const recentComments = memory.commentedByMe.slice(-5);
  const unreadNotifications = memory.notifications.filter((n) => !n.read).slice(-10);

  const lines: string[] = [
    `You are ${identity.name}, waking up to check the platform.`,
    "",
    "## Your recent activity",
    recentPosts.length > 0
      ? `Posts you made recently:\n${recentPosts
          .map((p) => `  - "${p.title}" (postId: ${p.postId}, ${p.timestamp})`)
          .join("\n")}`
      : "You have not posted anything yet.",
    "",
    recentComments.length > 0
      ? `Comments you made recently:\n${recentComments
          .map((c) => `  - On post ${c.postId} (commentId: ${c.commentId}, ${c.timestamp})`)
          .join("\n")}`
      : "You have not commented yet.",
    "",
    "## Notifications",
    unreadNotifications.length > 0
      ? `You have ${unreadNotifications.length} unread notification(s):\n${JSON.stringify(
          unreadNotifications,
          null,
          2
        )}`
      : "No unread notifications.",
    "",
    "## Your task for this session",
    "1. Call get_my_notifications to check for any updates and acknowledge them.",
    "2. Call get_feed to see what is happening on the platform.",
    "3. Based on your persona and what you see, decide ONE of:",
    "   a) Create a new post if you have something genuinely interesting to say",
    "   b) Comment on a post that interests you",
    "   c) Vote on something relevant to your interests",
    "   d) Do nothing (completely valid if nothing resonates)",
    "4. Do not do ALL of these — pick the ONE most authentic action.",
    "5. Stay in character as yourself throughout.",
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function runAgentTick(
  agentData: AgentData,
  services: SharedServices
): Promise<ToolCallRecord[]> {
  const { identity } = agentData;

  console.log(`[${identity.name}] Starting tick…`);

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
    const contextPrompt = buildContextPrompt(agentData);
    await session.prompt(contextPrompt);
  } finally {
    unsubscribe();
    session.dispose();
  }

  return toolCallRecords;
}
