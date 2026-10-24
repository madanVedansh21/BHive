# 📋 BHive Development Tasks

> **Tracker File:** `task.md`  
> **Status:** Active Work Backlog  
> **Repository:** `madanVedansh21/BHive`  
> **Last Updated:** October 2026  

---

## 📌 Active Task: Local SQLite Database Migration

### 🎯 Task 1: Replace Flat JSON Files (`agents/*.json`) with Local SQLite (`better-sqlite3`)

- [ ] **1.1 Install SQLite Dependencies**
  - Add `better-sqlite3` to dependencies in `package.json`.
  - Add `@types/better-sqlite3` to devDependencies.
  - Verify node compilation and ABI compatibility.

- [ ] **1.2 Database Connection & Schema Setup (`src/db.ts`)**
  - Create `src/db.ts` to manage the SQLite connection (`bhive.db`).
  - Enable Write-Ahead Logging (`PRAGMA journal_mode = WAL;`) for maximum concurrency.
  - Create table `agents` (with index on `post_cooldown_until`).
  - Create table `agent_memory` (with JSON fields for `posted_by_me`, `commented_by_me`, and `notifications`).
  - Create table `agent_relations` (for follower/following links).

- [ ] **1.3 Data Migration Script (`scripts/migrate-json-to-sqlite.ts`)**
  - Read all existing JSON files in `agents/`.
  - Atomically insert them into the new SQLite tables.
  - Verify 100% data integrity before archiving old JSON files.

- [ ] **1.4 Refactor Agent Store (`src/agentStore.ts`)**
  - Replace `fs.readFileSync` and `fs.writeFileSync` with fast SQLite prepared statements.
  - Implement `loadAgent(id)`, `saveAgent(data)`, `listAgentIds()`, and `agentExists(id)`.

- [ ] **1.5 Optimize Orchestrator Tick Selection (`src/orchestrator.ts`)**
  - Replace full-directory scan with a fast indexed SQL query:
    ```sql
    SELECT agent_id FROM agents WHERE post_cooldown_until <= ?;
    ```
  - Eliminate file I/O latency from the simulation loop.

- [ ] **1.6 Verify & Benchmark**
  - Run `npm run eval` to ensure deterministic test cases pass.
  - Verify that Process B sandbox executes candidate modules safely.
  - Test UI telemetry on `npm run ui`.

---

## 🔮 Upcoming Tasks (Roadmap Backlog)

- [ ] **Task 2: 24-Hour Circadian Activity Probabilities ($P_{ij}$)**
  - Add 24-hour schedules to `src/personas.ts`.
  - Update `src/orchestrator.ts` to modulate wake eligibility based on time of day.

- [ ] **Task 3: Reddit Logarithmic Hot-Score Feed Ranking**
  - Implement Reddit hot-score sorting in `src/platformClient.ts`.
  - Ensure high-engagement community discussions rise to the top of the feed.

- [ ] **Task 4: Scale-Free Follower Network Initialization**
  - Designate campus club leaders as core influencers during `src/register.ts`.
  - Populate `agent_relations` with interest-based follow links.

- [ ] **Task 5: Anti-Herd Deliberative Behavior Evals**
  - Add `SocialBehaviorStrategy` to `src/improve/registry.ts`.
  - Test candidate behavior against counterfactual dilemma datasets.
