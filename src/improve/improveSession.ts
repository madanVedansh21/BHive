// =============================================================================
// src/improve/improveSession.ts — Pi session dedicated to self-improvement.
//
// Usage:
//   npm run improve
//   or called from orchestrator cadence: runImprovementCycle(services)
//
// What it does:
//   1. Acquires lockfile (improvement/.lock) to serialize improvement cycles
//   2. Spins up an isolated Pi session with improve-tools ONLY (no post/comment tools)
//   3. Injects performance signals and reflection instructions
//   4. Agent inspects strategy code, evals, and proposes modifications
//   5. Releases lockfile on completion
// =============================================================================

import { bus } from "../eventBus";
import * as path from "path";
import * as fs from "fs";
import {
  createAgentSession,
  SessionManager,
  DefaultResourceLoader,
  AuthStorage,
  ModelRegistry,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai";
import { SharedServices } from "../types";
import { buildImproveTools, IMPROVE_TOOL_NAMES } from "../improveTools";

const LOCK_FILE = path.resolve(process.cwd(), "improvement", ".lock");

// ---------------------------------------------------------------------------
// Lockfile Management
// ---------------------------------------------------------------------------

function acquireLock(): boolean {
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });

  if (fs.existsSync(LOCK_FILE)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, "utf-8"));
      const lockPid = lockData.pid;
      // Check if the holding process is still running
      if (process.kill(lockPid, 0)) {
        return false; // Still active
      }
    } catch {
      // Stale or invalid lock
    }
  }

  const payload = { pid: process.pid, startedAt: new Date().toISOString() };
  fs.writeFileSync(LOCK_FILE, JSON.stringify(payload), "utf-8");
  return true;
}

function releaseLock(): void {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch {
    // Non-fatal
  }
}

// ---------------------------------------------------------------------------
// Fallback Services Builder for Standalone / CLI Execution
// ---------------------------------------------------------------------------

export function createImprovementServices(): SharedServices {
  const modelProvider = process.env.MODEL_PROVIDER ?? "anthropic";
  const modelId = process.env.MODEL_ID ?? "claude-opus-4-5";

  const authStorage = AuthStorage.create(`${process.cwd()}/.pi/agent/auth.json`);
  if (process.env.MY_KEY) {
    authStorage.setRuntimeApiKey("anthropic", process.env.MY_KEY);
  }

  const modelRegistry = ModelRegistry.create(
    authStorage,
    `${process.cwd()}/.pi/agent/models.json`
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (getModel as any)(modelProvider, modelId) as ReturnType<typeof getModel> | null;
  if (!model) {
    throw new Error(`Model ${modelProvider}/${modelId} not found.`);
  }

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 2 },
  });

  return {
    authStorage,
    modelRegistry,
    model,
    settingsManager,
  };
}

// ---------------------------------------------------------------------------
// System Prompt for Improvement Session
// ---------------------------------------------------------------------------

const IMPROVEMENT_SYSTEM_PROMPT = `
You are an autonomous AI Systems & Optimization Architect.
Your mandate is to evaluate, refine, and improve the agent's core strategy modules.

You are equipped with specialized introspection tools:
- list_improvable_files: view improvable targets, active version, baseline score
- read_improvable_file: view the current source code of a strategy module
- get_eval_report: view current test cases and evaluation scores
- propose_change: submit a revised complete version of default.ts for sandbox testing and promotion

RULES:
1. Always begin by inspecting list_improvable_files and get_eval_report for target 'memory'.
2. Read the source code using read_improvable_file.
3. Formulate ONE specific, testable hypothesis to improve performance (e.g. higher context density, improved actionability, clearer prioritization of unread notifications, cleaner formatting).
4. Any proposed change must strictly preserve the MemoryStrategy interface contract:
   - export function buildContext(memory: AgentMemory, identity: AgentIdentity): string
   - export function applyTickToMemory(memory: AgentMemory, records: ToolCallRecord[]): TickMemoryPatch
   - export const strategy: MemoryStrategy
   - export default strategy
5. Do NOT break existing functionality: notifications must be de-duplicated, postCooldownSet must be handled accurately, and all 10 ground-truth test cases must continue to pass.
6. Call propose_change with your revised complete code and a clear rationale.
7. If propose_change reports test errors or syntax issues, read the error message, refine your code, and propose again.
`;

// ---------------------------------------------------------------------------
// Run Improvement Cycle
// ---------------------------------------------------------------------------

export async function runImprovementCycle(services?: SharedServices): Promise<void> {
  console.log("\n=======================================================");
  console.log("  [BHive v2] Starting Autonomous Improvement Session   ");
  console.log("=======================================================");

  if (!acquireLock()) {
    console.log("[Improvement] Another improvement session is currently running. Skipping.");
    return;
  }

  bus.publish("improvement:session_start", { target: "memory" });

  const activeServices = services ?? createImprovementServices();
  const improveTools = buildImproveTools();
  const sessionPiDir = path.join(process.cwd(), ".pi", "improvement");

  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: sessionPiDir,
    settingsManager: activeServices.settingsManager,
    systemPromptOverride: () => IMPROVEMENT_SYSTEM_PROMPT,
  });
  await loader.reload();

  const sessionManager = SessionManager.inMemory();

  const { session } = await createAgentSession({
    cwd: process.cwd(),
    agentDir: sessionPiDir,
    model: activeServices.model,
    thinkingLevel: "low",
    authStorage: activeServices.authStorage,
    modelRegistry: activeServices.modelRegistry,
    tools: [...IMPROVE_TOOL_NAMES],
    customTools: improveTools,
    resourceLoader: loader,
    sessionManager,
    settingsManager: activeServices.settingsManager,
  });

  const unsubscribe = session.subscribe((event) => {
    if (event.type === "tool_execution_end") {
      if (!event.isError) {
        console.log(`  [Improvement] ✓ tool: ${event.toolName}`);
      } else {
        console.error(`  [Improvement] ✗ tool error: ${event.toolName}`);
      }
    } else if (event.type === "agent_end") {
      console.log("  [Improvement] Session completed.");
    }
  });

  try {
    const prompt = `
Initiate an architecture improvement cycle for target 'memory'.
1. Check list_improvable_files and get_eval_report.
2. Read the current memory strategy code.
3. Formulate a hypothesis to optimize the context prompt synthesis or memory update logic.
4. Submit your proposal using propose_change.
`;
    await session.prompt(prompt);
  } catch (err: unknown) {
    console.error("  [Improvement] Session error:", err);
  } finally {
    unsubscribe();
    session.dispose();
    releaseLock();
    console.log("=======================================================\n");
  }
}

// ---------------------------------------------------------------------------
// CLI Execution: npm run improve
// ---------------------------------------------------------------------------

async function main() {
  await runImprovementCycle();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[Improvement] Fatal error:", err);
    process.exit(1);
  });
}
