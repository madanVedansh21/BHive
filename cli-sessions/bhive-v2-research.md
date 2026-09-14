# BHive v2 — Research Foundation: Self-Improving Engine

> Synthesized from 6 parallel research streams. This document is the intellectual core of the improving engine — read this before writing a single line of v2 code.

---

## The Big Picture: What We Learned

Six research streams mapped the academic and engineering terrain. Here's what the field actually says, distilled down to what matters for building BHive v2.

---

## 1. LLM Self-Refinement: How Iterative Loops Actually Work

### The Core Papers & Their Mechanisms

**Self-Refine (Madaan et al., NeurIPS 2023)**
The loop: `Generate → Critique → Refine → Repeat (max 3x)`.
- Uses the *same* model for all three steps — no separate judge model needed
- Feedback is multi-aspect and structured, not "make this better"
- Works at inference time — zero fine-tuning required
- **Key insight**: Decoupling "generate" from "evaluate" into separate prompts dramatically outperforms single-pass generation

**Reflexion (Shinn et al., NeurIPS 2023)**
The loop: `Execute → External Verifier Fails → Verbal Reflection → Retry with Memory`.
- Requires an **external grounded verifier** (unit tests, compiler, eval runner) — not a self-opinion
- Verbal reflections are stored in episodic memory and included in subsequent attempts
- This is the pattern closest to what BHive v2 needs: external eval scores drive reflection

**Constitutional AI (Anthropic)**
The pattern: `Draft → Critique against specific principle → Revise → Critique against next principle → ...`
- The "constitution" is a numbered checklist — each principle inspected separately
- Far more reliable than "is this good?" because it's rule-matching, not open-ended judgment
- **Direct application**: Our improvement session should give the agent a constitution:
  *"1. Must not regress deterministic eval score. 2. Must improve judge median. 3. Must not alter public interface. 4. Must compile cleanly."*

**RLHF-Free / Best-of-N Rejection Sampling**
Pattern: `Generate N candidates → Filter through deterministic verifier → LLM-judge ranks survivors → Select winner`
- No fine-tuning, no weights modified — pure inference-time selection
- **This IS the BHive v2 proposal loop**: propose → fork → eval → accept/reject

### Hard Limits the Research Found

| Limit | What It Means For BHive |
|---|---|
| Cap iterations at 3 | After 3 failed proposals, lock the target and log. Don't let the agent spiral |
| Ground in real execution | Pure self-critique without a test suite hallucinates fixes after 2 iterations |
| Structural memory over full history | Store verbal summaries ("Attempt 1 failed: null-check missing on notifications array"), not raw token-heavy logs |
| Atomic rollback | Every proposal attempt must have an unmodified baseline snapshot to revert to |

### The Architecture This Points To

```
Improvement Session
    │
    ├── Agent reads strategy file + eval report + recent performance signals
    │
    ├── Agent produces proposal (ONE focused change + rationale)
    │
    ├── Sandbox runs: compile check → eval suite → judge
    │
    ├── If pass: accept + log verbal "what worked"
    │
    └── If fail: reject + feed error trace back as verbal reflection → retry (max 3x)
```

---

## 2. LLM-as-a-Judge: Building a Reliable Scorer

### What the Research Says (MT-Bench, Chatbot Arena, Anthropic)

**The critical findings:**
- Models below GPT-4 / Claude 3.5 Sonnet tier make mediocre judges — they lack meta-cognitive reasoning
- **Reasoning order matters critically**: the model MUST produce CoT rationale BEFORE the score, not after
- Generating a verdict token first, then rationalizing post-hoc = severe degradation
- Always use **rubric-anchored 1–5 scales**, not 1–10 (score compression makes 1-10 useless; everything clusters 7–9)
- Run judge **k=3 times, take the median** — single-sample scores are noise

### The 4 Biases You Must Defend Against

| Bias | Mechanism | Mitigation |
|---|---|---|
| **Position bias** | Judge favors first or second option regardless of quality | Swap order: run `Judge(A,B)` + `Judge(B,A)`, only count consistent wins |
| **Verbosity bias** | Longer = better in judge's mind, even if padded | Explicit rubric penalty: "Deduct points for filler words, preambles, repetition" |
| **Self-preference bias** | LLMs rate their own family's outputs higher | **Never use the actor model as its own judge** — use a different model family |
| **Score compression** | 1-10 scales cluster everything at 7-9 | Use 1-5 with explicit behavioral anchor for every integer |

### The Judge Prompt Pattern That Works

```
XML-delimited inputs → Scratchpad reasoning → Structured JSON output
```

Key rules:
1. Wrap inputs in XML tags to prevent the agent's output from hijacking judge instructions
2. Schema: `{ "rationale": {...}, "scores": {...}, "compositeScore": 0.0-1.0, "passed": bool }`
3. `rationale` field must come BEFORE `scores` in the JSON schema
4. Temperature: **0.0** — deterministic, cacheable, reproducible

### The Three Judge Targets for BHive

**Target 1: Memory Context Prompt Quality**
Dimensions (1-5): `density`, `actionability`, `fidelity`, `tokenEfficiency`

**Target 2: Post Quality**
Dimensions (1-5): `personaConsistency`, `socialValue`, `freshness`, `conciseness`

**Target 3: Comment Quality**
Dimensions (1-5): `contextRelevance`, `dialogueQuality`, `personaConsistency`, `grounding`

### Acceptance Rule (Non-Negotiable)

```
accept ⟺
  deterministic(candidate) ≥ deterministic(baseline) − 0.02   // no regression
  AND judgeMedian(candidate) > judgeMedian(baseline) + 0.05    // real improvement
  AND holdout(candidate) passes                                 // not overfitting
```

The `0.05` dead-band (ACCEPT_MARGIN) is essential — without it, judge noise alone causes constant churn.

---

## 3. Child Process in Node.js: The Isolation Layer

### `fork()` vs Everything Else

| | `spawn()` | `exec()` | `fork()` | `worker_threads` |
|---|---|---|---|---|
| IPC built-in | ❌ | ❌ | ✅ | Via `MessageChannel` |
| Node-only | ❌ | ❌ | ✅ | ✅ |
| Crash isolation | OS process | OS process | **OS process** | ❌ Same process — one crash kills all |
| Memory overhead | Low | Low | ~30–50MB/child | ~5–10MB/thread |
| Verdict for BHive | No | No | **YES — eval sandbox** | No |

### Why `fork()` for the Eval Sandbox (Process B)

- A runaway `while(true){}` in proposed strategy code **freezes only the child** — Process A's orchestrator keeps ticking
- C++ native addon crashes cannot kill the parent
- `SIGKILL` from the parent terminates the child cleanly with no state leak into Process A
- Full OS process boundary means proposed code cannot access Process A's memory, secrets, or require cache

### The IPC Contract Pattern (Typed, Discriminated Unions)

```typescript
// protocol.ts — shared between parent and child

export type ParentToChildMsg =
  | { type: 'RUN_EVAL'; proposalId: string; workspaceDir: string; datasetPath: string }
  | { type: 'SHUTDOWN' };

export type ChildToParentMsg =
  | { type: 'EVAL_RESULT'; proposalId: string; report: EvalReport }
  | { type: 'FATAL_ERROR'; error: { name: string; message: string; stack?: string } };
```

**Critical TypeScript gotcha**: `process.send` in `@types/node` is optional (`send?()`).
Always use: `process.send?.({ type: 'EVAL_RESULT', ... })` — not `process.send(...)`.

### Forking with TypeScript Files

```typescript
import { fork } from 'node:child_process';
import path from 'node:path';

const child = fork(path.resolve(__dirname, 'evalChild.ts'), [], {
  execArgv: [
    '--require', require.resolve('ts-node/register'),
    '--max-old-space-size=256',   // Hard memory cap
  ],
  silent: true,                  // Pipe stdout/stderr
  serialization: 'advanced',    // Handles Dates, Errors, BigInt properly
});
```

### The Timeout Pattern (Critical: infinite loops ignore SIGTERM)

A `while(true){}` in the child freezes its event loop — it never processes SIGTERM.
The parent must escalate to SIGKILL:

```typescript
function killChildGracefully(child: ChildProcess, graceMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    let forceKillTimer: NodeJS.Timeout | null = null;
    child.once('exit', () => { if (forceKillTimer) clearTimeout(forceKillTimer); resolve(); });

    child.kill('SIGTERM');                    // 1. Try graceful
    forceKillTimer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');  // 2. Escalate
      resolve();
    }, graceMs);
  });
}
```

> [!WARNING]
> On Windows, `SIGTERM` does not exist. `child.kill('SIGTERM')` immediately runs `TerminateProcess()` — equivalent to SIGKILL. Graceful shutdown handlers in the child will never fire on Windows.

### Must-Attach Event Handlers

```typescript
child.on('error', (err) => { /* MUST attach — missing this crashes the parent */ });
child.on('exit', (code, signal) => { /* reject pending promises */ });
child.stderr?.on('data', (chunk) => { /* log child stderr */ });
```

---

## 4. Hot Module Reloading: The Strategy Swap Mechanism

### The Architecture Decision

| Phase | Mechanism | Why |
|---|---|---|
| **Eval phase (Process B)** | `child_process.fork()` | Full crash isolation during risky test |
| **Active execution (Process A)** | `require.cache` eviction | Zero IPC latency, synchronous, native |

### How `require.cache` Eviction Actually Works

```typescript
// NAIVE — works but leaks memory after many reloads
const resolved = require.resolve(modulePath);
delete require.cache[resolved];
const fresh = require(resolved);

// PRODUCTION — recursive eviction + parent.children cleanup
function purgeCache(entryPath: string, baseDir: string): void {
  const resolved = require.resolve(entryPath);
  const mod = require.cache[resolved];
  if (!mod) return;

  // 1. Recursively purge local children (NOT node_modules)
  for (const child of [...(mod.children || [])]) {
    if (child.filename && !child.filename.includes('node_modules')
        && child.filename.startsWith(baseDir)) {
      purgeCache(child.filename, baseDir);
    }
  }

  // 2. Remove from parent.children to prevent memory leak
  const parent = mod.parent;
  if (parent?.children) {
    const idx = parent.children.indexOf(mod);
    if (idx !== -1) parent.children.splice(idx, 1);
  }

  // 3. Evict from cache
  delete require.cache[resolved];
}
```

### The 3 Gotchas That Will Bite You

| Gotcha | What Breaks | Fix |
|---|---|---|
| **Stale destructuring** | `const { buildContext } = loadStrategy()` — old function captured in closure | Always access via `registry.current.buildContext(...)` — never destructure across reload boundary |
| **Module-level state** | `let callCount = 0` inside strategy resets to 0 on reload | Keep strategies **pure + stateless** — pass all state as arguments |
| **Sub-dependency caching** | Deleting only `default.ts` leaves its `helpers.ts` import cached | Always purge recursively (see above) |

### ESM vs CommonJS for Hot Reload

**CommonJS**: ✅ Works perfectly via `require.cache` eviction
**ESM Dynamic `import()`**: ❌ Permanently leaks V8 module records in heap — every reload (`?t=${Date.now()}`) allocates a permanent C++ `ModuleRecord` that is never freed. Memory grows monotonically until OOM.

**Verdict**: If your project is ESM, convert the strategies directory to CJS interop (`require()` via `createRequire(import.meta.url)`) or keep the entire project CommonJS. Do NOT try to hot-reload ESM modules.

### ts-node Tip

Use `TS_NODE_TRANSPILE_ONLY=true` at runtime. Without it, ts-node re-runs the full TypeScript type-checker on every reload (300ms–1500ms per swap). With `transpileOnly`, it's ~5ms.

### The Hot Registry Pattern

```typescript
// src/improve/hotRegistry.ts
export class HotStrategyRegistry<T> {
  private activeStrategy: T | null = null;

  get current(): T {
    if (!this.activeStrategy) throw new Error('No strategy loaded. Call load() first.');
    return this.activeStrategy;
  }

  async load(targetPath: string): Promise<T> {
    const fullPath = path.resolve(this.baseDir, targetPath);

    // Security: prevent directory traversal
    if (!fullPath.startsWith(this.baseDir)) {
      throw new Error(`Security: "${fullPath}" escapes allowed root`);
    }

    this.purgeCache(fullPath);

    let rawModule: any;
    try {
      rawModule = require(require.resolve(fullPath));
    } catch (err: any) {
      throw new Error(`Failed to load strategy: ${err.message}`);
    }

    const candidate = rawModule.strategy ?? rawModule.default ?? rawModule;
    if (!this.validateContract(candidate)) {
      this.purgeCache(fullPath);
      throw new Error('Candidate failed contract validation');
    }

    // Atomic pointer swap
    if (this.activeStrategy && typeof (this.activeStrategy as any).dispose === 'function') {
      await (this.activeStrategy as any).dispose();
    }
    this.activeStrategy = candidate;
    return this.activeStrategy!;
  }
}
```

---

## 5. Agent Eval Pipelines: What the Tools Taught Us

### Cross-Tool Pattern Synthesis

| Tool | Best Idea to Steal |
|---|---|
| **Braintrust** | Typed `Scorer<TInput, TOutput, TExpected>` functional contract; per-sample delta diffing vs baseline |
| **PromptFoo** | YAML declarative test cases with `assert` arrays; `llm-rubric` as a scorer type; CI threshold gating |
| **OpenAI Evals** | Strict JSONL format (one test case per line); `modelgraded` eval type with choice maps |
| **LangSmith** | `Evaluator = ({ run, example }) => EvaluationResult` pattern; trajectory evaluators for tool-call sequences |
| **LMQL** | In-decoding constraints for structured output validation (applies to our TypeScript checker pre-fork) |

### The Dataset Format We Should Use (JSONL — Best of All Worlds)

```jsonl
{"id":"mem-001","description":"Duplicate notifications are de-duplicated","tags":["memory","dedup"],"input":{"memory":{"notifications":[{"id":"n1"},{"id":"n1"}]},"toolCallRecords":[]},"expected":{"memoryAssertions":[{"type":"notificationsUnique"}]},"metadata":{"difficulty":"easy"}}
{"id":"mem-002","description":"Post cooldown is set after createPost","tags":["cooldown","post"],"input":{"memory":{"postedByMe":[],"postCooldownUntil":0},"toolCallRecords":[{"tool":"createPost","postId":"p99","success":true}]},"expected":{"memoryAssertions":[{"type":"postedByMeContains","postId":"p99"},{"type":"postCooldownSet","value":true}]},"metadata":{"difficulty":"easy"}}
{"id":"mem-003","description":"Context prompt mentions unread notification","tags":["context","notifications"],"input":{"memory":{"notifications":[{"id":"n5","read":false,"content":"Alice replied to your post"}]}},"expected":{"contextAssertions":[{"type":"contextMentionsSubstring","value":"unread"}]},"metadata":{"difficulty":"medium"}}
```

### The Scorer Contract (Typed, Functional)

```typescript
// src/improve/evalRunner.ts

export interface ScoreResult {
  name: string;
  score: number;          // 0.0 – 1.0
  pass: boolean;
  reason?: string;
}

export type Scorer<TInput, TOutput, TExpected> = (ctx: {
  input: TInput;
  output: TOutput;
  expected?: TExpected;
}) => ScoreResult | Promise<ScoreResult>;
```

### The 3-Tier Eval Stack for BHive

```
Tier 1 (FAST, FREE, FIRST):    Syntax check + TypeScript compile (tsc --noEmit)
                                ↓ fail = instant reject, no further compute

Tier 2 (FAST, DETERMINISTIC):  evalRunner — JSONL dataset, exact-match assertions
                                Score ≥ baseline − 0.02 required to continue
                                ↓ fail = reject + verbal reflection

Tier 3 (SLOW, LLM):            judge.ts — k=3 median, rubric-anchored 1-5 scale
                                Score > baseline + 0.05 required to accept
                                Uses different model family from actor
```

### CI Integration Pattern

```typescript
// Commit baseline.json to the repo
// On every eval run, compare against it

const { summary, regressions } = await runEvalSuite({ ... });

if (regressions.length > 0) {
  console.error('REGRESSIONS:', regressions);
  process.exit(1);  // Fail CI
}

// If passing, optionally promote this run as new baseline
```

---

## 6. Self-Play: What We Borrow and What We Skip

### What AlphaZero / OpenAI Five Taught Us

The mechanisms that matter for text agents:

**Historical opponent pool (OpenAI Five key insight)**
OpenAI Five found that training only against the current self causes "strategy cycling" — the agent learns to beat its current version but forgets fundamentals. They fixed it by playing 20% of matches against historical checkpoints.

**BHive translation**: The improvement engine should compare proposed strategies not just against the current baseline, but against an archive of past accepted versions. A proposal that beats today's baseline but loses to v3 (two versions ago) should be flagged.

**Natural curriculum**
Self-play naturally creates a curriculum: you always compete at your own skill frontier. For content quality:
- Tier 1: Basic persona adherence, no hallucination
- Tier 2: Hook quality, anti-repetition, post freshness
- Tier 3: Emotional resonance, controversy handling, reader objection anticipation

**SPIN (Self-Play Fine-Tuning, UCLA 2024)**
Key insight: *The model's evaluative capability is stronger than its raw generative capability.* A model can recognize a weak output even when it couldn't have generated a better one from scratch.

**BHive translation**: The improvement session works because the agent can look at its own strategy code + eval scores and identify the weakness (evaluative mode), even if it wouldn't have written better code unprompted (generative mode).

### The Failure Modes to Actively Defend Against

| Failure | What It Looks Like in BHive | Defense |
|---|---|---|
| **Mode collapse** | Every proposed strategy revision uses the same narrow template | Diversity constraint: if 3 consecutive proposals look similar (same fix angle), force a different approach prompt |
| **Reward hacking** | Strategy games the judge by making context prompts verbose / keyword-stuffed | Deterministic floor score + holdout set the judge never sees during proposals |
| **Echo chamber** | Actor model critiques its own proposals favorably | Separate judge model (different provider/family) |
| **Semantic drift** | Strategy code drifts toward alien patterns over 10 generations | Archive v1 baseline; rollback if aggregate performance degrades vs. v1 |

### The Self-Play Loop for BHive (Inference-Time, No Fine-Tuning)

```
For each improvement cadence tick:

1. CANDIDATE GENERATION
   Agent reads: current strategy code + eval report + recent post/comment judge scores + engagement signals
   Agent produces: ONE proposed change + behavioral hypothesis ("This change should improve actionability
   because the current context prompt buries notification urgency")

2. ADVERSARIAL VALIDATION (inside child process)
   → tsc --noEmit check
   → deterministic eval suite (visible 80%)
   → judge (k=3, median, rubric-anchored)
   → holdout eval (hidden 20%) — only on pass

3. TOURNAMENT vs HISTORY POOL
   → Compare score vs baseline
   → Compare score vs top-3 historical accepted versions
   → Must beat all of them by ACCEPT_MARGIN

4. ACCEPT or REJECT
   Accept: archive old → atomic swap → cache-bust → bump version → log to history.jsonl
   Reject: discard → append rejection rationale to agent's episodic memory → retry (max 3)

5. AFTER 3 CONSECUTIVE FAILURES
   → Lock target for COOLDOWN_MS
   → Log: "Target 'memory' locked after 3 failures. Last error: ..."
```

---

## The Synthesis: What to Build and In What Order

Every research stream pointed to the same architecture. Here is the implementation hierarchy:

```
Phase 0: Strategy Extraction (no behavior change)
   src/strategies/memory/default.ts  ← extract from agentSession + agentStore
   src/improve/registry.ts           ← hot registry (already scaffolded)
   Verify: identical behavior, orchestrator unchanged

Phase 1: Offline Eval Harness
   src/improve/dataset/memory.v0.jsonl   ← 10 hand-written ground truth cases
   src/improve/evalRunner.ts             ← JSONL loader + typed scorers
   npm run eval                          ← prints score, saves to improvement/state/memory.json
   Verify: breaking a case drops the reported score

Phase 2: Judge Pipeline
   src/improve/judge.ts             ← k=3 median, rubric-anchored, DIFFERENT model
   Apply to recent real posts       ← eyeball: do scores match human intuition?

Phase 3: Introspection Tools (read-only)
   src/improveTools.ts              ← list_improvable_files, read_improvable_file, get_eval_report
   src/improve/improveSession.ts    ← Pi session with improve-tools only
   Verify: agent produces sensible improvement hypothesis when prompted manually

Phase 4: The Closed Loop
   src/improve/sandbox.ts           ← validate → fork → IPC → timeout → cleanup
   src/improve/promoter.ts          ← compare, archive, atomic swap, history.jsonl
   propose_change tool added to improve session
   Verify: plant suboptimal strategy → watch cycle detect, propose, test, accept/reject

Phase 5: Production Hardening
   Cadence in orchestrator (slower than activity ticks)
   Budgets: MAX_PROPOSALS_PER_DAY=3, MAX_CONSECUTIVE_FAILURES=3
   Lockfile: improvement/.lock (serialize cycles)
   REQUIRE_HUMAN_APPROVAL=true mode
   npm run rollback -- --target memory
```

---

## Key Engineering Decisions (Research-Backed)

| Decision | Choice | Reason |
|---|---|---|
| Process isolation for eval | `child_process.fork()` | Full OS crash isolation; worker_threads share V8 heap |
| Hot swap in Process A | `require.cache` eviction | Zero latency; ESM dynamic import leaks memory permanently |
| Serialization | `serialization: 'advanced'` | Handles Error objects, Dates, Maps natively over IPC |
| Judge scale | 1–5 behavioral Likert | 1–10 compresses to 7–9; 1–5 with anchors is calibrated |
| Judge sampling | k=3 median | Single sample is noise; median robust against outlier runs |
| Judge provider | Different family from actor | Self-preference bias is empirically documented and significant |
| Dataset format | JSONL | Git-diffable, streaming, line-by-line debuggable |
| Acceptance gate | Deterministic floor + judge margin | Deterministic catches regressions; judge catches quality |
| Max retry attempts | 3 | Research shows diminishing returns + regression risk after 3 iterations |
| Holdout split | 20% hidden | Primary defense against Goodharting the visible eval set |

---

## Files to Create (v2 Complete File Map)

```
src/
  improve/
    types.ts          ✅ done — MemoryStrategy interface
    registry.ts       ✅ done — cache-busting loader
    hotRegistry.ts    🔲 — production HotStrategyRegistry class (with recursive purge)
    evalRunner.ts     🔲 — JSONL loader, typed scorers, baseline comparison
    judge.ts          🔲 — k=3 median judge, rubric templates, provider config
    evalChild.ts      🔲 — child process entry point (runs inside Process B)
    sandbox.ts        🔲 — validate → fork → IPC → timeout → cleanup
    promoter.ts       🔲 — compare / archive / atomic-swap / rollback / history.jsonl
    improveSession.ts 🔲 — Pi session with improve-tools only
    dataset/
      memory.v0.jsonl 🔲 — 10 hand-written ground truth cases
  improveTools.ts     🔲 — defineTool wrappers: list, read, get_report, propose
  strategies/
    memory/
      default.ts      🔲 — logic extracted from agentSession + agentStore

improvement/
  state/
    memory.json       🔲 — { baseline, version, samples, updatedAt }
  history.jsonl       🔲 — append-only audit trail
  archive/memory/     🔲 — v1.js, v2.js... rollback ring
  .lock               🔲 — serializes concurrent cycles
  workspaces/         🔲 — ephemeral sandboxes (gitignored)
```

---

*This document is the pre-build research foundation. All decisions above are backed by the six research streams: Self-Refinement, LLM-as-a-Judge, Node.js Child Process, Hot Module Reloading, Agent Eval Pipelines, and Self-Play. Build Phase 0 next.*
