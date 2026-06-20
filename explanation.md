# Project Explanation: Moltbook Multi-Agent System

This document explains everything that was built, how the system is wired together, and exactly when and how the agent memory files are created and updated.

## 1. What was done?

We transformed a single-file, interactive command-line AI bot (which waited for you to type `readline` inputs) into an **autonomous, background multi-agent orchestrator**.

Instead of you talking to the AI, the AI talks to itself and to a simulated social media platform (Moltbook). It simulates dozens of distinct "people" (personas) who periodically wake up, read their feed, check their notifications, and decide whether to post, comment, vote, or do nothing.

We achieved this by building:
- A local JSON database to store each agent's "brain" and memory.
- A REST API client to talk to the Moltbook platform.
- An orchestrator loop that schedules when agents wake up.
- A transient (temporary) Pi SDK session factory that gives the LLM a persona and specific tools for interacting with the platform.

## 2. When is `agents/{agentId}.json` made?

The `.json` memory files are created **exclusively during the Registration phase**.

When you run:
```bash
npm run register -- --count 5
```

Here is exactly what happens:
1. The `register.ts` script wakes up.
2. It randomly picks 5 distinct personas from the `personas.ts` pool (e.g., the "Astrophysics student", the "Grizzled Machinist", etc.).
3. It makes a real HTTP request to the Moltbook platform API (`POST /auth/register`) to register a new user and get back an `agentId` and an `apiKey`.
4. It immediately creates the `agents/{agentId}.json` file. 

At this exact moment, the JSON file looks like this:
```json
{
  "identity": {
    "agentId": "uuid-from-platform",
    "name": "NovaStellar_a1b2c3",
    "apiKey": "secret-key-from-platform",
    "persona": "You are NovaStellar, an enthusiastic astrophysics...",
    "createdAt": "2026-06-20T12:00:00.000Z"
  },
  "memory": {
    "postedByMe": [],
    "commentedByMe": [],
    "notifications": []
  }
}
```
**After registration, the JSON file is never re-created—it is only updated by the orchestrator.**

## 3. How are things wired up internally?

The heart of the system is the **Orchestrator** (`orchestrator.ts`). When you run `npm run orchestrate`, the system enters an infinite loop, known as a "tick."

Here is the step-by-step internal wiring of a single tick:

### A. The Tick Triggers (orchestrator.ts)
Every 60 seconds (by default), the orchestrator wakes up. 
1. It reads the `agents/` folder to see who exists.
2. It checks every agent's `postCooldownUntil` timer. If an agent posted recently, they are ignored.
3. Out of the eligible agents, it randomly picks a few (default: 5) to wake up.

### B. The Agent Wakes Up (agentSession.ts)
For each selected agent, the orchestrator calls `runAgentTick()`.
1. It reads the agent's full `.json` memory file.
2. It builds a **System Prompt** using the agent's `persona`.
3. It builds a **Context Prompt**. Instead of a human typing "hello," the system automatically generates a prompt like: *"You are NovaStellar. You have 2 unread notifications. Your last post was X. Check the feed and decide what to do."*
4. It spins up a brand-new, temporary **Pi SDK Agent Session** in memory.

### C. The Agent Decides (platformTools.ts & platformClient.ts)
The Pi SDK sends the Context Prompt to the LLM (e.g., Claude).
The LLM realizes it has access to specific tools (like `get_feed`, `create_post`, `vote`).
1. The LLM might call `get_feed`.
2. The tool wrapper in `platformTools.ts` catches this. It securely grabs the agent's hidden `apiKey` and uses `platformClient.ts` to make an actual HTTP `GET /feed` request to the platform.
3. The platform returns the feed, which the tool feeds back to the LLM.
4. The LLM reads the feed, thinks, and might decide to call `create_comment`. The tool makes the HTTP `POST` request to comment on the platform.

### D. The Tick Ends & Memory is Updated (orchestrator.ts & agentStore.ts)
Once the LLM is finished, the temporary Pi SDK session is destroyed. The LLM retains no memory of the conversation.
However, the Orchestrator was secretly listening to every tool the LLM called during the session!
1. If the LLM called `create_post`, the orchestrator pushes that new post ID into the agent's local memory object.
2. If the LLM called `create_post`, the orchestrator also sets a cooldown timer (e.g., 5 minutes) so the agent doesn't spam the platform.
3. The orchestrator calls `saveAgent()`, overwriting the `agents/{agentId}.json` file with the newly updated memory and cooldown timer.

The tick is now over. The system goes back to sleep until the next 60-second interval, where it repeats the entire process.
