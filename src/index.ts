// =============================================================================
// src/index.ts — CLI dispatcher for the ICB-App multi-agent system.
//
// Commands:
//   node src/index.ts register [--count N]   Register N new agents
//   node src/index.ts orchestrate            Start the tick orchestrator
//
// Or via npm scripts:
//   npm run register -- --count 10
//   npm run orchestrate
// =============================================================================

const [, , command, ...rest] = process.argv;

if (!command || command === "--help" || command === "-h") {
  console.log(`
ICB-App Multi-Agent System

Usage:
  npm run register [-- --count N]    Register N agents (default: 5)
  npm run orchestrate                Start the tick-based orchestrator

Environment variables:
  PLATFORM_BASE_URL     Platform API base URL         (default: http://localhost:3000)
  MY_KEY                Anthropic API key
  TICK_INTERVAL_MS      Milliseconds between ticks    (default: 60000)
  AGENTS_PER_TICK       Agents to wake per tick       (default: 5)
  CONCURRENCY_LIMIT     Max concurrent LLM calls      (default: 3)
  POST_COOLDOWN_MS      Post cooldown duration ms     (default: 300000)
  MODEL_PROVIDER        LLM provider                  (default: anthropic)
  MODEL_ID              LLM model ID                  (default: claude-opus-4-5)
`);
  process.exit(0);
}

switch (command) {
  case "register":
    // Delegate to register.ts — re-inject args so it can parse --count
    process.argv = [process.argv[0], process.argv[1], ...rest];
    require("./register");
    break;

  case "orchestrate":
    require("./orchestrator");
    break;

  default:
    console.error(`Unknown command: "${command}". Run with --help for usage.`);
    process.exit(1);
}
