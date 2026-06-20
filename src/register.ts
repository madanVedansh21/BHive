// =============================================================================
// src/register.ts — One-time agent registration script.
//
// Usage:
//   npm run register              (registers 5 agents)
//   npm run register -- --count 20
//
// Requires: PLATFORM_BASE_URL env var (default http://localhost:3000)
// =============================================================================

import { v4 as uuidv4 } from "uuid";
import { registerAgent } from "./platformClient.js";
import { saveAgent, agentExists } from "./agentStore.js";
import { pickPersonas } from "./personas.js";
import { AgentData } from "./types.js";

function parseArgs(): { count: number } {
  // function to parse command line args for --count : how many agents to register
  const args = process.argv.slice(2);
  let count = 5;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--count" && args[i + 1]) {
      count = parseInt(args[i + 1], 10);
      if (isNaN(count) || count < 1) {
        console.error("--count must be a positive integer");
        process.exit(1);
      }
    }
  }
  return { count };
}

async function main() {
  const { count } = parseArgs();
  console.log(
    `\n🚀 Registering ${count} agent(s) on ${process.env.PLATFORM_BASE_URL ?? "http://localhost:3000"}…\n`,
  );

  const personas = pickPersonas(count);
  const created: string[] = [];

  for (const persona of personas) {
    // Derive a unique name — append short UUID fragment to avoid collisions
    const desiredName = `${persona.suggestedName}_${uuidv4().slice(0, 6)}`;

    try {
      console.log(`  Registering "${desiredName}"…`);
      const { agentId, apiKey } = await registerAgent(desiredName);

      if (agentExists(agentId)) {
        console.warn(
          `  ⚠  Agent ${agentId} already exists locally — skipping write.`,
        );
        continue;
      }

      const agentData: AgentData = {
        identity: {
          agentId,
          name: desiredName,
          apiKey,
          persona: persona.persona,
          createdAt: new Date().toISOString(),
        },
        memory: {
          postedByMe: [],
          commentedByMe: [],
          notifications: [],
        },
      };

      saveAgent(agentData);
      created.push(agentId);
      console.log(`  ✅ ${desiredName} — agentId: ${agentId}`);
    } catch (err) {
      console.error(`  ❌ Failed to register "${desiredName}":`, err);
    }
  }

  console.log(`\nDone. Created ${created.length}/${count} agents.`);
  if (created.length > 0) {
    console.log("Agent IDs:");
    created.forEach((id) => console.log(`  • ${id}`));
  }
}

main().catch((err) => {
  console.error("Registration failed:", err);
  process.exit(1);
});
