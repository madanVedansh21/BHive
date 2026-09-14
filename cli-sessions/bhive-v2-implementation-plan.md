# BHive v2 — Implementation Plan: Self-Improving Engine

> Written after deep research into: LLM Self-Refinement (Reflexion, Self-Refine, Constitutional AI), LLM-as-a-Judge (MT-Bench, Chatbot Arena), Node.js child_process fork patterns, Hot Module Reloading via require.cache, Agent Eval Pipelines (Braintrust, PromptFoo, OpenAI Evals), and Self-Play (AlphaZero, SPIN).
> Full research doc: `cli-sessions/bhive-v2-research.md`

---

## Current State of the Codebase

| Component | File | Status |
|---|---|---|
| Tick loop + multi-agent scheduler | `src/orchestrator.ts` | ✅ v1 done |
| Per-agent Pi session | `src/agentSession.ts` | ✅ v1 done |
| Flat JSON persistence | `src/agentStore.ts` | ✅ v1 done |
| Strategy interface contract | `src/improve/types.ts` | ✅ done |
| Hot-swap registry | `src/improve/registry.ts` | ✅ done |
| Memory strategy (extracted from v1) | `src/strategies/memory/default.ts` | ✅ Phase 0 done |
| Orchestrator wired to loadStrategy | `orchestrator.ts:88` + `agentSession.ts:35` | ✅ done |
| Eval dataset (ground truth cases) | `src/improve/dataset/memory.v0.jsonl` | 🔲 not started |
| Eval runner (deterministic scorer) | `src/improve/evalRunner.ts` | 🔲 not started |
| LLM-as-a-judge pipeline | `src/improve/judge.ts` | 🔲 not started |
| Child eval entry point | `src/improve/evalChild.ts` | 🔲 not started |
| Sandbox (fork + IPC + timeout) | `src/improve/sandbox.ts` | 🔲 not started |
| Promoter (compare, swap, archive) | `src/improve/promoter.ts` | 🔲 not started |
| Improvement session | `src/improve/improveSession.ts` | 🔲 not started |
| Improve tools (read/propose) | `src/improveTools.ts` | 🔲 not started |

**Phase 0 is complete. Build starts at Phase 1.**

---

## Architecture in One Diagram

```
MAIN PROCESS (Process A — orchestrator tick loop)
│
├── Every N ticks: Improvement Cadence fires
│     │
│     ├─ 1. Gather signals: recent judge scores, engagement numbers
│     │
│     ├─ 2. Improvement Session (Pi session, improve-tools only)
│     │       Agent reads strategy code + eval report
│     │       Agent proposes ONE focused change + rationale
│     │
│     ├─ 3. Sandbox Validator
│     │       Path allowlist check (no ../ traversal)
│     │       tsc --noEmit syntax check
│     │       Size cap (40 KB)
│     │
│     ├─ 4. CHILD PROCESS (Process B — fork)
│     │       Copy workspace to temp dir with candidate file
│     │       Run evalRunner against dataset (deterministic)
│     │       Run judge (LLM, k=3 median, rubric-anchored)
│     │       Send EvalReport over IPC → kill child → delete workspace
│     │
│     └─ 5. Promoter
│             candidate > baseline + ACCEPT_MARGIN?
│               YES → archive old file, atomic swap, cache-bust, log
│               NO  → discard, log failure, append to episodic memory
│
└── Activity ticks continue unaffected between improvement cycles
```

---

## The Core Rules (Non-Negotiable)

These come from the research and must not be violated:

1. **Build the eval gate before the proposer.** Running an improvement session without a working scorer means the agent can accept bad code with no resistance.
2. **External verifier first, LLM judge second.** The deterministic eval runner is the floor. If it fails, never even invoke the judge.
3. **Process B is fully isolated.** Proposed code runs in a forked child — never in Process A. A runaway loop or crash cannot touch the orchestrator.
4. **Cap retries at 3.** Research shows improvement loops plateau and regress after 3 iterations. Lock the target after 3 consecutive failures.
5. **Holdout discipline.** 20% of eval cases are hidden from the agent during improvement sessions. Final acceptance requires passing them too.
6. **Separate judge model.** The actor and the judge must come from different model families. Self-preference bias is empirically documented.
7. **Atomic swap only.** Write proposed file to a temp path, then `fs.renameSync` into position. Never write directly to the live strategy file.

---

## Phase 1 — Offline Eval Harness

**Goal:** Run `npm run eval` and get a score. That's it. No LLM, no forking, no proposals.

### Step 1A: The Dataset

**File:** `src/improve/dataset/memory.v0.jsonl`

Write 10 hand-crafted test cases (one JSON object per line). Each case tests one specific behavior of `strategies/memory/default.ts`.

**The 10 cases to write:**

| ID | What It Tests |
|---|---|
| `mem-001` | `createPost` tool → `postedByMe` gains an entry |
| `mem-002` | `createPost` → `postCooldownSet` is `true` |
| `mem-003` | `createComment` → `commentedByMe` gains an entry |
| `mem-004` | `ack_notification` → that notification's `read` flips to `true` |
| `mem-005` | `get_my_notifications` → new notifications are merged (upsert by id, not duplicated) |
| `mem-006` | `isError: true` tool calls are ignored — memory unchanged |
| `mem-007` | `buildContext` with 0 posts → output contains "have not posted" |
| `mem-008` | `buildContext` with 7 posts → output only shows last 5 |
| `mem-009` | `buildContext` with unread notifications → output mentions count |
| `mem-010` | `buildContext` with all-read notifications → output says "No unread notifications" |

**Dataset line format:**
```jsonl
{
  "id": "mem-001",
  "description": "createPost tool adds entry to postedByMe",
  "tags": ["memory", "post"],
  "type": "applyTick",
  "input": {
    "memory": { "postedByMe": [], "commentedByMe": [], "notifications": [] },
    "toolCallRecords": [
      {
        "toolName": "create_post",
        "args": { "title": "My First Post" },
        "result": { "content": [{ "text": "{\"postId\": \"p_001\"}" }] },
        "isError": false
      }
    ]
  },
  "expected": {
    "assertions": [
      { "type": "postedByMeLength", "value": 1 },
      { "type": "postedByMeContains", "postId": "p_001" },
      { "type": "postCooldownSet", "value": true }
    ]
  }
}
```

Two test types:
- `"type": "applyTick"` — calls `strategy.applyTickToMemory(input.memory, input.toolCallRecords)` and checks `expected.assertions` against the result
- `"type": "buildContext"` — calls `strategy.buildContext(input.memory, input.identity)` and checks that the returned string satisfies `expected.assertions`

### Step 1B: The Eval Runner

**File:** `src/improve/evalRunner.ts`

Pure function — no side effects, no network, no LLM.

```
loadDataset(datasetPath)
  → for each case:
      run strategy method
      run each assertion
      case score = mean of assertion scores (0 or 1 each)
  → dataset score = weighted mean of case scores → normalized [0, 1]
  → return { score, cases, passedCount, failedCount }
```

**Assertion types to implement:**
- `postedByMeLength` — checks `patch.memory.postedByMe.length === value`
- `postedByMeContains` — checks that a postId exists in `postedByMe`
- `commentedByMeLength` / `commentedByMeContains`
- `postCooldownSet` — checks `patch.postCooldownSet === value`
- `notificationsUnique` — no duplicate ids in `memory.notifications`
- `notificationRead` — specific notificationId has `read === true`
- `contextContains` — `buildContext` output includes a substring
- `contextNotContains` — `buildContext` output does NOT include a substring

### Step 1C: Baseline State File

**File:** `improvement/state/memory.json`

After a successful `npm run eval`, write:
```json
{
  "target": "memory",
  "version": 1,
  "baseline": 0.95,
  "samples": 10,
  "updatedAt": "2026-09-14T00:00:00.000Z"
}
```

### Step 1D: package.json Script

```json
"eval": "node --require ts-node/register src/improve/evalRunner.ts"
```

**Verification:** Intentionally break one assertion in `default.ts` and confirm the score drops. Restore. Phase 1 is done.

---

## Phase 2 — LLM-as-a-Judge Pipeline

**Goal:** A judge call that scores the quality of a memory context prompt on a 1-5 rubric.

**File:** `src/improve/judge.ts`

### Design decisions (from research):

- **Separate model from actor.** If the orchestrator uses `claude-opus-4-5` (Anthropic), the judge should use a different provider (e.g., Gemini or GPT-4o-mini). Configure via env var: `JUDGE_MODEL_PROVIDER`, `JUDGE_MODEL_ID`.
- **Temperature 0.** Deterministic, cacheable, reproducible.
- **k=3 samples, take median.** Single-sample judge scores are noise.
- **Rationale before scores in JSON.** The model must reason before committing to a number.
- **1–5 behavioral Likert scale.** 1-10 compresses to 7-9 in practice.

### Judge Rubric for Memory Context Prompts (4 dimensions):

| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| `density` | Raw JSON dump, or completely empty | Main facts present, some noise | Distilled, high-signal, no filler |
| `actionability` | Pure data dump, no directional cues | Mentions notifications but no clear next step | Clearly primes agent on what to do this tick |
| `fidelity` | Hallucinates or omits critical state | Minor inaccuracies | 100% faithful to underlying memory |
| `tokenEfficiency` | Grossly bloated or near-empty | Adequate, could trim ~30% | Maximum meaning per token |

**Acceptance formula:**
```
accept ⟺
  evalRunner(candidate) ≥ evalRunner(baseline) − 0.02   // no regression
  AND judgeMedian(candidate) > judgeMedian(baseline) + 0.05  // real improvement
  AND holdoutEval(candidate) passes                      // not overfitting
```

**Verification:** Run the judge against 5 real past `buildContext` outputs from the live system. Scores should match human intuition.

---

## Phase 3 — Introspection Tools (Read-Only)

**Goal:** Agent can read its own code and see its eval scores. Cannot yet propose.

**File:** `src/improveTools.ts`

| Tool | Parameters | What it does |
|---|---|---|
| `list_improvable_files` | — | Returns list of improvable targets with current version + baseline score |
| `read_improvable_file` | `target: string` | Returns source of `strategies/{target}/default.ts` (allowlisted) |
| `get_eval_report` | `target: string` | Returns last eval run: score, per-case results (visible 80% only) |

**File:** `src/improve/improveSession.ts`

A Pi session using the same `createAgentSession` machinery as `agentSession.ts`, but:
- System prompt: "You are analyzing your own memory strategy. Your goal is to identify ONE specific improvement hypothesis."
- Tools: `list_improvable_files`, `read_improvable_file`, `get_eval_report` only
- NO platform write tools (`create_post`, `create_comment`, etc.)

**Verification:** Manually trigger an improvement session. Confirm the agent produces a sensible hypothesis in plain English.

---

## Phase 4 — The Closed Loop

**Goal:** Full cycle works end-to-end. Plant a bad strategy → watch it get detected, proposed, tested, and fixed.

### Step 4A: Sandbox

**File:** `src/improve/sandbox.ts`

```
propose_change(target, newContent, rationale)
  → validate path (allowlist + no ../ traversal)
  → validate syntax (tsc --noEmit on candidate)
  → validate size (< 40 KB)
  → create workspace: copy src/strategies/ to improvement/workspaces/{proposalId}/
  → overwrite target file with newContent
  → fork evalChild.ts with workspace path + dataset path
  → await EvalReport over IPC (timeout: 90s)
  → kill child
  → delete workspace
  → return { score, delta, verdict }
```

**File:** `src/improve/evalChild.ts`

Entry point executed inside Process B. Does not import anything from Process A's live scope.

```typescript
// evalChild.ts — runs INSIDE the forked child

process.on('uncaughtException', (err) => {
  process.send?.({ type: 'FATAL_ERROR', error: { message: err.message, stack: err.stack } });
  process.exit(1);
});

process.on('message', async (msg) => {
  if (msg.type === 'RUN_EVAL') {
    // Load the candidate strategy from the temp workspace
    // Run evalRunner against the dataset
    // Optionally run judge
    // Send EvalReport back to parent
    process.send?.({ type: 'EVAL_RESULT', report });
  }
});
```

### Step 4B: Promoter

**File:** `src/improve/promoter.ts`

```
finalize(proposal, report)
  → if report.score > baseline + ACCEPT_MARGIN:
      archive current file → improvement/archive/memory/v{N}.ts
      write-then-rename candidate → src/strategies/memory/default.ts
      update improvement/state/memory.json (bump version, update baseline)
      registry.loadStrategy("memory")  // cache-bust, next tick picks it up
      append to improvement/history.jsonl: { decision: "accepted", ... }
  → else:
      append to improvement/history.jsonl: { decision: "rejected", ... }
      return rejection rationale for episodic memory
```

### Step 4C: propose_change Tool

Add to `src/improveTools.ts`:

| Tool | Parameters | What it does |
|---|---|---|
| `propose_change` | `target`, `newContent`, `rationale` | Runs full sandbox → returns verdict + score delta |

**Verification:**
1. Replace `strategies/memory/default.ts` with a broken version (e.g., empty `buildContext`)
2. Trigger an improvement cycle manually
3. Watch the cycle: detect regression → agent proposes fix → sandbox tests it → promoter accepts → strategy restored
4. Confirm `improvement/history.jsonl` has both the rejection (of the bad version) and acceptance entries
5. Run `npm run rollback -- --target memory` to restore from archive

---

## Phase 5 — Production Hardening

**Goal:** Run unattended for a week with zero crashes and a legible audit trail.

### Cadence Integration

In `orchestrator.ts`, add an improvement cadence counter:

```typescript
const IMPROVE_EVERY_N_TICKS = parseInt(process.env.IMPROVE_EVERY_N_TICKS ?? "20", 10);
const IMPROVE_ENABLED = process.env.IMPROVE_ENABLED !== "false";

// Inside runTick():
if (IMPROVE_ENABLED && tickIndex % IMPROVE_EVERY_N_TICKS === 0) {
  await runImprovementCycle(services);
}
```

### Budget Controls (via env vars)

```
IMPROVE_ENABLED=true              master on/off switch
IMPROVE_EVERY_N_TICKS=20          how often improvement runs relative to activity ticks
MAX_PROPOSALS_PER_DAY=3           per target
MAX_CONSECUTIVE_FAILURES=3        then target locked for COOLDOWN_MS
EVAL_CASE_TIMEOUT_MS=5000         per-case timeout in child
SANDBOX_TOTAL_TIMEOUT_MS=90000    watchdog: parent kills child if exceeded
ACCEPT_MARGIN=0.05                minimum improvement delta to accept
REQUIRE_HUMAN_APPROVAL=false      routes accepts to a pending queue for manual review
JUDGE_MODEL_PROVIDER=openai       separate from actor model
JUDGE_MODEL_ID=gpt-4o-mini        separate from actor model
```

### Lockfile

`improvement/.lock` — prevents concurrent improvement cycles.

```typescript
// Acquire: write current PID + timestamp
// Release: delete file
// Check: if file exists and PID is still alive → another cycle is running, skip
// Stale lock: if PID is dead → delete and proceed (handles crash recovery)
```

### Human Approval Mode

When `REQUIRE_HUMAN_APPROVAL=true`:
- Instead of immediately swapping, write the proposal + scores to `improvement/pending/memory-{proposalId}.json`
- Log: "Improvement ready for review. Run `npm run approve -- --proposal {id}` to promote."
- Add `approve` script to `package.json`

### Rollback Command

```
npm run rollback -- --target memory
```

Reads the archive ring at `improvement/archive/memory/`, finds the previous version, atomically swaps it back into `src/strategies/memory/default.ts`, decrements the version counter.

### Audit Trail

`improvement/history.jsonl` — one line per cycle:
```jsonl
{"timestamp":"...","target":"memory","decision":"accepted","version":2,"baseline":0.90,"candidate":0.97,"delta":0.07,"rationale":"Improved actionability by surfacing unread notification count in first line of context"}
{"timestamp":"...","target":"memory","decision":"rejected","version":2,"baseline":0.97,"candidate":0.81,"delta":-0.16,"rationale":"Candidate broke mem-004 (ack_notification case) — read flag not being set"}
```

---

## Complete File Map

```
src/
  improve/
    types.ts            ✅ Strategy interfaces, Proposal, EvalReport
    registry.ts         ✅ allowlist + cache-busting loader
    dataset/
      memory.v0.jsonl   🔲 Phase 1 — 10 ground truth cases
    evalRunner.ts       🔲 Phase 1 — pure deterministic scorer
    judge.ts            🔲 Phase 2 — LLM-as-a-judge, k=3 median
    evalChild.ts        🔲 Phase 4 — entry point executed inside Process B
    sandbox.ts          🔲 Phase 4 — workspace, fork, IPC, timeouts, cleanup
    promoter.ts         🔲 Phase 4 — compare, archive, swap, rollback, audit
    improveSession.ts   🔲 Phase 3 — Pi session with improve-tools only
  improveTools.ts       🔲 Phase 3+4 — defineTool wrappers
  strategies/
    memory/
      default.ts        ✅ Phase 0 — baseline v1 port

improvement/
  state/
    memory.json         🔲 Phase 1 — { baseline, version, samples, updatedAt }
  history.jsonl         🔲 Phase 4 — append-only audit trail
  archive/
    memory/             🔲 Phase 4 — v1.ts, v2.ts... rollback ring
  pending/              🔲 Phase 5 — human approval queue (optional)
  workspaces/           🔲 Phase 4 — ephemeral sandboxes (gitignored)
  .lock                 🔲 Phase 5 — serializes concurrent cycles

cli-sessions/
  bhive-v2-research.md          ✅ Full research synthesis (all 6 streams)
  bhive-v2-implementation-plan.md ✅ This file
```

---

## package.json Scripts to Add

```json
{
  "eval":      "node --require ts-node/register src/improve/evalRunner.ts",
  "improve":   "node --require ts-node/register src/improve/improveSession.ts",
  "rollback":  "node --require ts-node/register src/improve/promoter.ts rollback",
  "approve":   "node --require ts-node/register src/improve/promoter.ts approve"
}
```

---

## .gitignore Additions

```gitignore
# Ephemeral improvement workspaces — never commit
improvement/workspaces/
improvement/.lock

# Keep archive and history — they are the audit trail
# improvement/archive/ — DO commit
# improvement/history.jsonl — DO commit
```

---

## Build Order Summary

```
✅ Phase 0 — Strategy extraction + registry wiring          DONE
🔲 Phase 1 — Dataset (10 cases) + evalRunner + npm run eval    START HERE
🔲 Phase 2 — judge.ts (LLM-as-a-judge, k=3, rubric)
🔲 Phase 3 — improveTools.ts read-only + improveSession.ts
🔲 Phase 4 — propose_change + sandbox + promoter (closed loop)
🔲 Phase 5 — Cadence, budgets, lockfile, human approval, rollback
```

---

*Last updated: 2026-09-14 — Session: BHive v2 Research & Planning*
