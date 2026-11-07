# 📋 BHive Development Tasks

> **Tracker File:** `task.md`  
> **Status:** Active Work Backlog  
> **Repository:** `madanVedansh21/BHive`  
> **Last Updated:** October 2026  

---

## ✅ Completed Tasks

### 🎯 Task 1: Replace Flat JSON Files (`agents/*.json`) with Local SQLite (`better-sqlite3`)
- [x] **1.1 Install SQLite Dependencies**
  - Added `better-sqlite3` and `@types/better-sqlite3`.
  - Node ABI compiled cleanly under Node v22.
- [x] **1.2 Database Connection & Schema Setup (`src/db.ts`)**
  - Created `src/db.ts` managing `bhive.db` (configurable via `BHIVE_DB_PATH`).
  - Enabled WAL mode (`PRAGMA journal_mode = WAL;`) and foreign keys (`PRAGMA foreign_keys = ON;`).
  - Initialized tables: `agents`, `agent_memory`, `agent_relations` with index on `post_cooldown_until`.
- [x] **1.3 Data Migration Script (`scripts/migrate-json-to-sqlite.ts`)**
  - Created migration script and npm script `"db:migrate"`.
  - Migrated all 10 existing agent JSON files into SQLite cleanly.
- [x] **1.4 Refactor Agent Store (`src/agentStore.ts`)**
  - Replaced disk file reads/writes with fast prepared SQL statements (`loadAgent`, `saveAgent`, `listAgentIds`, `agentExists`).
  - Added fast indexed query `getEligibleAgentIds(now)`.
- [x] **1.5 Optimize Orchestrator Tick Selection (`src/orchestrator.ts`)**
  - Replaced directory scanning with `getEligibleAgentIds(now)` running an indexed SQL lookup in microseconds.
- [x] **1.6 Verify & Benchmark**
  - `npm run eval` passed 10/10 tests (100% score).
  - `npx tsc --noEmit` and `npm run build` compiled with 0 errors.

---

## 📌 Immediate Active Task: Knowledge Graph & Episodic/Semantic Memory Architecture

### 🎯 Task 2: Cognitive Memory Architecture (Knowledge Graph + Episodic & Semantic Memory)
> ⚠️ **STATUS: ON HOLD / RESEARCH & DESIGN PHASE**  
> **DO NOT EXECUTE YET.** Awaiting user's open-source repository selection and architectural decisions.

- [ ] **2.1 Memory Schema & Graph Storage Design**
  - Integrate selected open-source Knowledge Graph repository or lightweight SQLite tables (`agent_memory_nodes`, `agent_memory_edges`).
  - Support node types: `episodic` (past events), `semantic` (core beliefs/facts), and `entity` (other agents, topics, clubs).
  - Support edge relations: `AGREES_WITH`, `DISLIKES`, `INTERESTED_IN`, `COLLABORATED_ON`.
- [ ] **2.2 Episodic Memory Recording**
  - Capture meaningful interactions after each tick (who the agent debated, what was the outcome, timestamp, emotional stance).
  - Avoid recording trivial metadata; summarize key conversation shifts.
- [ ] **2.3 Semantic Memory Distillation & Personality Consistency**
  - Extract long-term beliefs, stances, and preferences from repeated episodic experiences.
  - Anchor core persona traits so agents do not contradict their past positions over time.
- [ ] **2.4 On-Demand Memory Retrieval Tool (`recall_memory`)**
  - Give agents a tool to query their Knowledge Graph on-demand (`recall_memory({ targetAgent, topic })`).
  - Keep the default LLM prompt lean and prevent context window bloat by only pulling relevant graph hops.
- [ ] **2.5 Update Memory Strategy & Context Builder**
  - Update `src/strategies/memory/` to build context prompts using high-priority semantic anchors rather than raw, unorganized post IDs.
- [ ] **2.6 Verify & Benchmark**
  - Run `npm run eval` and verify test suite passes without regressions.

---

## 🔮 Upcoming Tasks (Roadmap Backlog)

- [ ] **Task 3: MBTI Persona Profiles & Reddit Seed Data Analysis**
  - 3A: Kaggle MBTI CSV analysis in Google Colab (writing style, word ratios, statistical ANOVA/Cohen's d comparisons)
  - 3B: Arctic Shift Reddit scraper in VS Code (targeted extraction from `r/developersIndia`, `r/Btechtards`, `r/college`, etc.)
  - 3C: Integration of `analysis/mbti_profiles.json` and `seeds/*.json` into BHive.

- [ ] **Task 4: 24-Hour Circadian Activity Probabilities ($P_{ij}$)**
  - Wire timestamp-derived or research-backed hourly probability vectors into `src/personas.ts`.
  - Update `agents.hourly_probabilities` in SQLite.
  - Update `src/orchestrator.ts` to modulate wake eligibility based on time of day.

- [ ] **Task 5: Reddit Logarithmic Hot-Score Feed Ranking**
  - Implement Reddit hot-score sorting in `src/platformClient.ts`.
  - Ensure high-engagement community discussions rise to the top of the feed.

- [ ] **Task 6: Scale-Free Follower Network Initialization**
  - Designate campus club leaders as core influencers during `src/register.ts`.
  - Populate `agent_relations` with interest-based follow links.

- [ ] **Task 7: Anti-Herd Deliberative Behavior Evals**
  - Add `SocialBehaviorStrategy` to `src/improve/registry.ts`.
  - Test candidate behavior against counterfactual dilemma datasets to prevent copycat downvoting.
