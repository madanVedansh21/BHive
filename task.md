# Task Tracker — ICB-App Multi-Agent System

## Legend
- `[ ]` Not started
- `[/]` In progress
- `[x]` Done

---

## Phase 1: Project Setup

- [x] Update `package.json` — add `p-limit`, `uuid`, add scripts (`register`, `orchestrate`, `build`, `start`)
- [x] Update `tsconfig.json` — enable `resolveJsonModule`, fix duplicate `types` key, add `ignoreDeprecations`

---

## Phase 2: Types & Shared Structures

- [x] Create `src/types.ts` — `AgentIdentity`, `AgentMemory`, `AgentData`, `SharedServices`, `ToolCallRecord`

---

## Phase 3: Platform API Client

- [x] Create `src/platformClient.ts` — thin fetch wrapper with `x-api-key` header and typed methods:
  - `getFeed(apiKey)`
  - `getPostDetail(apiKey, postId)`
  - `getPostComments(apiKey, postId)`
  - `createPost(apiKey, title, content, subcom)`
  - `createComment(apiKey, postId, content, parentCommentId?)`
  - `vote(apiKey, postId, direction)`
  - `getMyNotifications(apiKey)`
  - `ackNotification(apiKey, notificationId)`
  - `registerAgent(desiredName)` — one-time auth

---

## Phase 4: Platform Tools (Pi `defineTool` wrappers)

- [x] Create `src/platformTools.ts` — factory `buildPlatformTools(apiKey: string)` + `PLATFORM_TOOL_NAMES`

---

## Phase 5: Agent Memory Store

- [x] Create `src/agentStore.ts` — file-based agent JSON persistence (atomic write-then-rename):
  - `loadAgent(agentId)`
  - `saveAgent(agentData)`
  - `listAgentIds()`
  - `agentExists(agentId)`
  - `emptyMemory()`

---

## Phase 6: Persona Pool

- [x] Create `src/personas.ts` — 25 distinct personas with unique voices + `pickPersonas(count)`

---

## Phase 7: Per-Agent Pi Session Factory

- [x] Create `src/agentSession.ts` — `runAgentTick(agentData, sharedServices)`:
  - Shared services passed in (authStorage, modelRegistry, model, settingsManager)
  - Per-agent in-memory `SessionManager` per tick
  - Dynamic system prompt from `identity.persona`
  - Platform tools only (no read/bash/edit/write)
  - `tool_execution_end` subscription for capturing calls
  - Context prompt from persona + recent memory + unread notifications
  - Returns `ToolCallRecord[]`

---

## Phase 8: Registration Script

- [x] Create `src/register.ts`:
  - Accepts `--count N` CLI arg (default 5)
  - Picks distinct personas from pool (shuffled)
  - Calls `POST /auth/register` for each
  - Writes `agents/{agentId}.json` with full identity + empty memory

---

## Phase 9: Orchestrator

- [x] Create `src/orchestrator.ts`:
  - Shared Pi services loaded once at startup
  - `setInterval` tick loop (configurable via `TICK_INTERVAL_MS`)
  - Random sample of `AGENTS_PER_TICK` eligible agents per tick
  - Per-agent cooldown check (`postCooldownUntil`)
  - Concurrency cap via `p-limit` (`CONCURRENCY_LIMIT`)
  - Memory updated after each session (posts, comments, notifications, cooldown)
  - Graceful SIGINT/SIGTERM shutdown

---

## Phase 10: Entry Point Refactor

- [x] Refactor `src/index.ts` — clean CLI dispatcher:
  - `register` → runs `register.ts`
  - `orchestrate` → runs `orchestrator.ts`
  - `--help` usage message
  - Old readline loop removed

---

## Phase 11: Wire-Up & Testing

- [x] Install `p-limit` and `uuid` dependencies
- [x] Compile TypeScript — zero errors (`npx tsc --noEmit` passes clean)
- [ ] Dry-run register script (requires live platform API)
- [ ] Dry-run orchestrator single tick with a small agent pool
- [ ] Verify `agents/` directory structure and memory updates post-tick
