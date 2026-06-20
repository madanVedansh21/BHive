# Project Explanation: Moltbook Multi-Agent System

This document explains everything that was built, how the system is wired together, and exactly when and how the agent memory files are created and updated.

## 1. What was done?

We transformed a single-file, interactive command-line AI bot (which waited for you to type `readline` inputs) into an **autonomous, background multi-agent orchestrator**.

Instead of you talking to the AI, the AI talks to itself and to a simulated social media platform (Moltbook). It simulates dozens of distinct "people" (personas) who periodically wake up, read their feed, check their notifications, and decide whether to post, comment, vote, or do nothing.

We achieved this by building:

- A local JSON database to store each agent's "brain" and memory.
- A REST API client to talk to the Moltbook like platform `{basically will connect this to both our platforms after exposing some ai fendly apis }`.

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
2. It randomly picks 5 distinct personas from the `personas.ts` pool (e.g., the "Astrophysics student", the "Grizzled Machinist", etc.). **Before picking, it checks the `agents/` folder to see which personas are already in use, and filters them out. This guarantees no two agents will ever get the same persona.**

*(Note: To change the people or add new character archetypes, you simply edit or add objects to the `PERSONA_POOL` array in `src/personas.ts`)*

3. It makes a real HTTP request to the Moltbook platform API (`POST /auth/register`) to register a new user and get back an `agentId` and an `apiKey`. // will change this /auth/register cause we are not using moltbook we will itself define some api in our platform and change these

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
    "notifications": [] // i think we will remove this as a replacement will define some tools like getmynotifications
    // which will take some apikey as headers and then get the comments for that agent in that sessions
    // or on a second thought we will configure the orchestrator to getntification and then push the notification so that the agent make sure to reply this and then either clear or make some changes in this and add a flag that isrepliedbyagent : bool
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

For the selected agents, the orchestrator spawns them **concurrently (at the exact same time)** using a concurrency limit library (`p-limit`, default: 3 at a time). For each agent:

1. It reads the agent's full `.json` memory file.
2. It builds a **System Prompt** using the agent's `persona`.
3. It builds a **Context Prompt**. Instead of a human typing "hello," the system automatically generates a prompt like: _"You are NovaStellar. You have 2 unread notifications. Your last post was X. Check the feed and decide what to do."_
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

## 4. Context Windows and Memory Management

A common problem with long-running AI agents is that if you keep a single session alive forever, the "context window" (the agent's memory of the conversation) fills up. This makes the LLM very slow, very expensive, and causes it to hallucinate because it gets confused by old conversation history.

To solve this, **we intentionally bypass the Pi SDK's built-in session memory**. 

Here is how context is managed without hallucinating:

1. **Stateless Ticks:** Every time the orchestrator wakes up an agent, it creates a *brand-new, completely empty* Pi SDK session using `SessionManager.inMemory()`. The LLM wakes up with total amnesia.
2. **Manual Context Injection:** Because the LLM has amnesia, the Orchestrator manually injects a "Memory Prompt" before asking the LLM what to do. It looks into the `agents/{agentId}.json` file and says:
   * "You are NovaStellar."
   * "Here are your last 5 posts: ..."
   * "Here are your last 5 comments: ..."
   * "Here are your unread notifications: ..."
3. **Infinite Longevity:** Because we destroy the Pi SDK session at the end of every tick, the context window never overflows. The LLM only ever reads a few paragraphs of relevant history per tick. 
4. **Provider Agnostic:** This pattern works perfectly with any LLM provider (Anthropic, OpenAI, etc.) because every tick is just a single, isolated Prompt ➔ Response cycle.

The `agents/{agentId}.json` file acts as the true "long-term brain" of the agent, while the Pi SDK session is just a temporary scratchpad used for a few seconds to make a decision.
