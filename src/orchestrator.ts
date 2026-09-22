// =============================================================================
// src/orchestrator.ts — Tick-based multi-agent scheduler.
//
// Usage (standalone): npm run orchestrate
// Usage (with UI):    npm run ui  (uiServer.ts calls startOrchestrator())
//
// Environment variables:
//   PLATFORM_BASE_URL     Base URL of the platform API  (default: http://localhost:3000)
//   MY_KEY                Anthropic API key
//   TICK_INTERVAL_MS      Milliseconds between ticks    (default: 60000 = 1 minute)
//   AGENTS_PER_TICK       Agents to wake per tick       (default: 5)
//   CONCURRENCY_LIMIT     Max simultaneous LLM calls    (default: 3)
//   POST_COOLDOWN_MS      Post cooldown duration ms     (default: 300000 = 5 minutes)
//   MODEL_PROVIDER        LLM provider                  (default: anthropic)
//   MODEL_ID              LLM model ID                  (default: claude-opus-4-5)
// =============================================================================

import { getModel } from "@earendil-works/pi-ai";
import {
  AuthStorage,
  ModelRegistry,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import pLimit from "p-limit";
import { loadAgent, listAgentIds, saveAgent } from "./agentStore";
import { runAgentTick } from "./agentSession";
import { AgentData, SharedServices } from "./types";
import { loadStrategy } from "./improve/registry";
import { runImprovementCycle } from "./improve/improveSession";
import { bus } from "./eventBus";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TICK_INTERVAL_MS = parseInt(process.env.TICK_INTERVAL_MS ?? "60000", 10);
const AGENTS_PER_TICK = parseInt(process.env.AGENTS_PER_TICK ?? "5", 10);
const CONCURRENCY_LIMIT = parseInt(process.env.CONCURRENCY_LIMIT ?? "3", 10);
const POST_COOLDOWN_MS = parseInt(process.env.POST_COOLDOWN_MS ?? "300000", 10);
const MODEL_PROVIDER = process.env.MODEL_PROVIDER ?? "anthropic";
const MODEL_ID = process.env.MODEL_ID ?? "claude-opus-4-5";
const IMPROVE_ENABLED = process.env.IMPROVE_ENABLED === "true";
const IMPROVE_CADENCE_TICKS = parseInt(process.env.IMPROVE_CADENCE_TICKS ?? "20", 10);

// Pause flag — toggled by UI commands via uiServer
let paused = false;
export function setOrchestratorPaused(value: boolean): void { paused = value; }
export function isOrchestratorPaused(): boolean { return paused; }

// ---------------------------------------------------------------------------
// Tick execution
// ---------------------------------------------------------------------------

async function runTick(services: SharedServices, tickIndex: number): Promise<void> {
  if (paused) {
    console.log(`[Orchestrator] Tick #${tickIndex} skipped — paused.`);
    return;
  }

  const tickStart = Date.now();
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[Orchestrator] Tick #${tickIndex} at ${new Date().toISOString()}`);

  const allIds = listAgentIds();
  if (allIds.length === 0) {
    console.log("[Orchestrator] No agents registered. Run `npm run register` first.");
    return;
  }

  const now = Date.now();
  const eligible = allIds.filter((id) => {
    try {
      const agent = loadAgent(id);
      const cooldown = agent.identity.postCooldownUntil;
      return !cooldown || now >= cooldown;
    } catch {
      return false;
    }
  });

  if (eligible.length === 0) {
    console.log("[Orchestrator] All agents are on cooldown. Skipping tick.");
    return;
  }

  const shuffled = eligible.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, AGENTS_PER_TICK);

  console.log(
    `[Orchestrator] Waking ${selected.length} agent(s) (${eligible.length} eligible / ${allIds.length} total):`
  );
  selected.forEach((id) => {
    const name = loadAgent(id).identity.name;
    console.log(`  • ${name} (${id})`);
  });

  // Emit tick start event
  bus.publish("orchestrator:tick_start", {
    tickIndex,
    selectedAgents: selected.map((id) => {
      try { return { agentId: id, name: loadAgent(id).identity.name }; }
      catch { return { agentId: id, name: id }; }
    }),
    eligibleCount: eligible.length,
    totalCount: allIds.length,
  });

  const limit = pLimit(CONCURRENCY_LIMIT);
  const memoryStrategy = loadStrategy("memory");

  const tasks = selected.map((agentId) =>
    limit(async () => {
      let agentData: AgentData;
      try {
        agentData = loadAgent(agentId);
      } catch (err) {
        console.error(`[Orchestrator] Failed to load agent ${agentId}:`, err);
        return;
      }

      try {
        const toolCallRecords = await runAgentTick(agentData, services, tickIndex);
        const patch = memoryStrategy.applyTickToMemory(
          agentData.memory,
          toolCallRecords
        );
        agentData.memory = patch.memory;

        if (patch.postCooldownSet) {
          agentData.identity.postCooldownUntil = Date.now() + POST_COOLDOWN_MS;
          console.log(
            `  [${agentData.identity.name}] Post cooldown set until ${new Date(
              agentData.identity.postCooldownUntil
            ).toISOString()}`
          );
        }

        saveAgent(agentData);
        console.log(`  [${agentData.identity.name}] Memory updated & saved.`);

        // Emit session end
        bus.publish("agent:session_end", {
          agentId: agentData.identity.agentId,
          name: agentData.identity.name,
          tickIndex,
          toolCallCount: toolCallRecords.length,
          memory: agentData.memory,
        });
      } catch (err) {
        console.error(`  [${agentData.identity.name}] Tick failed:`, err);
      }
    })
  );

  await Promise.all(tasks);

  const durationMs = Date.now() - tickStart;
  console.log(`[Orchestrator] Tick #${tickIndex} complete.\n`);

  // Emit tick end
  bus.publish("orchestrator:tick_end", { tickIndex, durationMs });

  if (IMPROVE_ENABLED && tickIndex > 0 && tickIndex % IMPROVE_CADENCE_TICKS === 0) {
    try {
      await runImprovementCycle(services);
    } catch (improveErr) {
      console.error("[Orchestrator] Improvement cadence cycle encountered an error:", improveErr);
    }
  }
}

// ---------------------------------------------------------------------------
// Exported entry point (called by uiServer or directly)
// ---------------------------------------------------------------------------

export async function startOrchestrator(): Promise<void> {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║     ICB-App Multi-Agent Orchestrator        ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`  Platform URL  : ${process.env.PLATFORM_BASE_URL ?? "http://localhost:3000"}`);
  console.log(`  Tick interval : ${TICK_INTERVAL_MS}ms`);
  console.log(`  Agents/tick   : ${AGENTS_PER_TICK}`);
  console.log(`  Concurrency   : ${CONCURRENCY_LIMIT}`);
  console.log(`  Post cooldown : ${POST_COOLDOWN_MS}ms`);
  console.log(`  Model         : ${MODEL_PROVIDER}/${MODEL_ID}`);
  console.log(`  Improvement   : ${IMPROVE_ENABLED ? `every ${IMPROVE_CADENCE_TICKS} ticks` : "disabled (set IMPROVE_ENABLED=true)"}`);
  console.log("");

  const authStorage = AuthStorage.create(
    `${process.cwd()}/.pi/agent/auth.json`
  );
  if (process.env.MY_KEY) {
    authStorage.setRuntimeApiKey("anthropic", process.env.MY_KEY);
  }

  const modelRegistry = ModelRegistry.create(
    authStorage,
    `${process.cwd()}/.pi/agent/models.json`
  );

  const model = (getModel as any)(MODEL_PROVIDER, MODEL_ID) as ReturnType<typeof getModel> | null;
  if (!model) {
    throw new Error(
      `Model ${MODEL_PROVIDER}/${MODEL_ID} not found. Check MODEL_PROVIDER and MODEL_ID env vars.`
    );
  }

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 2 },
  });

  const services: SharedServices = {
    authStorage,
    modelRegistry,
    model,
    settingsManager,
  };

  // Emit started event
  bus.publish("orchestrator:started", {
    tickIntervalMs: TICK_INTERVAL_MS,
    agentsPerTick: AGENTS_PER_TICK,
    concurrencyLimit: CONCURRENCY_LIMIT,
    improvementEnabled: IMPROVE_ENABLED,
    improveCadenceTicks: IMPROVE_CADENCE_TICKS,
    platformBaseUrl: process.env.PLATFORM_BASE_URL ?? "http://localhost:3000",
  });

  let tickIndex = 0;
  let running = true;

  const shutdown = () => {
    console.log("\n[Orchestrator] Shutdown signal received. Stopping after current tick…");
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await runTick(services, tickIndex++);

  const intervalHandle = setInterval(async () => {
    if (!running) {
      clearInterval(intervalHandle);
      console.log("[Orchestrator] Exited cleanly.");
      process.exit(0);
    }
    await runTick(services, tickIndex++);
  }, TICK_INTERVAL_MS);

  console.log(
    `[Orchestrator] Running. Next tick in ${TICK_INTERVAL_MS / 1000}s. Ctrl+C to stop.`
  );
}

// ---------------------------------------------------------------------------
// Standalone CLI entry point (npm run orchestrate)
// ---------------------------------------------------------------------------

if (require.main === module) {
  startOrchestrator().catch((err) => {
    console.error("[Orchestrator] Fatal error:", err);
    process.exit(1);
  });
}
