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

## 📌 Active Task: MBTI & Reddit Data Analysis

### 🎯 Task 2: Build MBTI Persona Profiles + Reddit Seed Data
> This task **must complete before Task 3** — the hourly activity curves and writing style profiles it produces are the data foundation for all agent behavior improvements.

#### 2A — MBTI Analysis (Google Colab)
- [ ] **2A.1 Download Dataset**
  - Kaggle: [kaggle.com/datasets/datasnaek/mbti-type](https://www.kaggle.com/datasets/datasnaek/mbti-type)
  - File: `mbti_1.csv` (~8,600 users × 50 posts each, labeled with MBTI type)
- [ ] **2A.2 Explode Posts & Calculate Writing Style Metrics Per Type**
  - Average, median, and 90th percentile post length
  - Question frequency (`?`), exclamation frequency (`!`), link usage (`http`)
  - Opinion opener rate (`I think`, `IMO`), hedge opener rate (`maybe`, `I guess`)
  - First-person ratio, ALL CAPS ratio
- [ ] **2A.3 Vocabulary Fingerprint Per Type**
  - Top 30 non-stopword words per type
  - Semantic ratios: feeling words, logic words, future/abstract words, detail words, people words, system words
- [ ] **2A.4 Statistical Comparison Across All 16 Types**
  - Run ANOVA on each metric across all 16 types (p < 0.05 = real difference)
  - Run pairwise t-tests with Bonferroni correction for significant pairs
  - Calculate Cohen's d effect size — only encode differences with d > 0.5 into agent personas
  - K-Means clustering to find which types are behaviorally similar (may reduce 16 → ~6 templates)
- [ ] **2A.5 Visualise & Report**
  - Heatmap: all metrics × all 16 types
  - Bar charts: post length, question rate, link usage by type
  - Box plots: Feeling vs Thinking axis, Introvert vs Extravert axis
- [ ] **2A.6 Hourly Activity from `r/mbti` via Arctic Shift**
  - Pull timestamped posts from `r/mbti` where flair = MBTI type
  - Extract hour of day (0–23) from `created_utc`
  - Build hourly histograms per type → normalize to 24-number probability array
  - Only use types with >50 posts. Set `hourly_activity: null` for types with insufficient data.
  - **Do NOT invent activity curves from assumptions.**
- [ ] **2A.7 Export `analysis/mbti_profiles.json`**
  - 16 MBTI type entries, each with writing style, vocabulary, behavior tendencies, and hourly activity (or null)

#### 2B — Reddit Seed Data Collection (VS Code + Python)
- [ ] **2B.1 Write Arctic Shift Scraper Script**
  - Use `requests` + `json` + `pandas`
  - Pull top 500 posts per subreddit from Arctic Shift API
  - For each post, fetch top 50 comments, keep top 5 with score > 20
- [ ] **2B.2 Target Subreddits**
  - `r/developersIndia` — tech, placements, startup life
  - `r/Btechtards` — college chaos, hostel, exams
  - `r/college` — general college life
  - `r/india` — broader Indian social context
  - `r/cscareerquestions` — career anxiety, job search
- [ ] **2B.3 Filter & Clean**
  - Skip: deleted/removed posts, posts < 20 words, comments < 10 words, upvote ratio < 0.60
  - Strip: all usernames, author info, awards — keep content only
- [ ] **2B.4 Export `seeds/<subreddit>.json`**
  - One file per subreddit, structure: `{ id, title, body, score, upvote_ratio, created_utc, top_comments[] }`

#### 2C — Handoff to BHive Integration
- [ ] **2C.1 Drop output files into BHive project:**
  ```
  BHive/analysis/mbti_profiles.json
  BHive/seeds/developersIndia.json
  BHive/seeds/Btechtards.json
  BHive/seeds/college.json
  BHive/seeds/india.json
  BHive/seeds/cscareerquestions.json
  ```
- [ ] **2C.2 Integration work (done in VS Code after handoff):**
  - Wire `mbti_profiles.json` into `src/personas.ts`
  - Build `scripts/seed-platform-discussions.ts` to load seed JSONs into platform DB

---

## 🔮 Upcoming Tasks (Roadmap Backlog)

- [ ] **Task 3: 24-Hour Circadian Activity Probabilities**
  - Depends on Task 2 hourly activity data from `r/mbti` timestamps
  - Wire MBTI-derived `hourly_activity` arrays into `src/personas.ts`
  - Populate `hourly_probabilities` column in SQLite for all agents
  - Update `src/orchestrator.ts` to roll probability dice per agent per tick

- [ ] **Task 5: Reddit Logarithmic Hot-Score Feed Ranking**
  - Implement Reddit hot-score sorting in `src/platformClient.ts`.
  - Ensure high-engagement community discussions rise to the top of the feed.

- [ ] **Task 6: Scale-Free Follower Network Initialization**
