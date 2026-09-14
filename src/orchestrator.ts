// =============================================================================
// src/orchestrator.ts — Tick-based multi-agent scheduler.
//
// Usage:
//   npm run orchestrate
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
import { loadAgent, listAgentIds, saveAgent } from "./agentStore.js";
import { runAgentTick } from "./agentSession.js";
import { AgentData, SharedServices } from "./types.js";
import { loadStrategy } from "./improve/registry.js";
import { runImprovementCycle } from "./improve/improveSession.js";

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

// ---------------------------------------------------------------------------
// Tick execution
// ---------------------------------------------------------------------------

async function runTick(services: SharedServices, tickIndex: number): Promise<void> {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[Orchestrator] Tick #${tickIndex} at ${new Date().toISOString()}`);

  const allIds = listAgentIds();
  if (allIds.length === 0) {
    console.log("[Orchestrator] No agents registered. Run `npm run register` first.");
    return;
  }

  // Filter by cooldown
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

  // Randomly sample up to AGENTS_PER_TICK agents
  const shuffled = eligible.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, AGENTS_PER_TICK);

  console.log(
    `[Orchestrator] Waking ${selected.length} agent(s) (${eligible.length} eligible / ${allIds.length} total):`
  );
  selected.forEach((id) => {
    const name = loadAgent(id).identity.name;
    console.log(`  • ${name} (${id})`);
  });

  // Run with concurrency cap
  const limit = pLimit(CONCURRENCY_LIMIT);

  // Loaded once per tick — accepted improvement swaps apply from the next tick
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
        const toolCallRecords = await runAgentTick(agentData, services);
        const patch = memoryStrategy.applyTickToMemory(
          agentData.memory,
          toolCallRecords
        );
        agentData.memory = patch.memory;

        // Cooldown policy stays orchestrator-owned (env-driven), strategy stays pure
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
      } catch (err) {
        console.error(`  [${agentData.identity.name}] Tick failed:`, err);
      }
    })
  );

  await Promise.all(tasks);
  console.log(`[Orchestrator] Tick #${tickIndex} complete.\n`);

  // Run autonomous improvement cycle on cadence
  if (IMPROVE_ENABLED && tickIndex > 0 && tickIndex % IMPROVE_CADENCE_TICKS === 0) {
    try {
      await runImprovementCycle(services);
    } catch (improveErr) {
      console.error("[Orchestrator] Improvement cadence cycle encountered an error:", improveErr);
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
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

  // Build shared Pi services (created once, reused every tick)
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  let tickIndex = 0;
  let running = true;

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[Orchestrator] Shutdown signal received. Stopping after current tick…");
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Run first tick immediately
  await runTick(services, tickIndex++);

  // Then schedule subsequent ticks
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

main().catch((err) => {
  console.error("[Orchestrator] Fatal error:", err);
  process.exit(1);
});
