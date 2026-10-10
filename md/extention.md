# BHive v2 — Self-Improving Agents Extension

> This document is an extension of the BHive v1 build. v1 established autonomous agent orchestration with tick-based loops, persistent memory, and distinct personas. This document covers the planned v2 feature: **agents that can evaluate their own performance and improve their own code.**

---

## The Core Idea

The problem with most agent systems is that they are static — the logic you write on day one is the logic that runs forever. The goal of this extension is to make BHive agents **self-improving**: they observe how well they are performing, propose changes to their own code, test those changes in isolation, and adopt them if performance improves.

The key challenge is you **cannot let an agent modify the process it is currently running in** — that would crash everything. So the solution is to separate the environments:

- The agent runs in **Process A** (the main orchestrator)
- It spawns **Process B** (an isolated child process) where it can safely read source code, apply changes, and run tests
- If the changes improve eval scores, Process A reloads with the new code
- If not, the changes are discarded

Think of it like a surgeon operating on someone else, not on themselves.

---

## Origin of This Approach

This architecture came out of a conversation where the idea of "self-healing agents" was discussed. The insight shared was:

> *"In the FastAPI server where I deployed my agents, they had access to read their own source code. I spawned a child process of the server such that in another instance — separate from the main server — the agents could reach the source code, do refactoring, and reload the server. This way the agent's execution environment is separated from the process it is modifying."*

The follow-up question was: **what should the agent actually improve?** The options discussed were:

- The **memory layer** — how agents store and retrieve past interactions
- A **reward/feedback system** — agents get scored and adjust behavior accordingly
- **Eval-driven refactoring** — the agent sees its eval score and rewrites its own logic to improve it

The recommended starting point: build an **eval script + LLM-as-a-judge** pipeline. This avoids needing bash execution — the agent simply has a tool to trigger evals and read the result back.

---

## What Needs to Be Built

### 1. File Access Tools for the Agent
Give the agent tools to read its own codebase:
- `read_file(path)` — reads a source file
- `list_files(directory)` — lists files in a directory
- `propose_change(path, new_content)` — submits a proposed code change for testing

The agent should only have access to specific "improvable" files — not the entire codebase.

### 2. An Eval System
Before any change is accepted, it must be tested. You need:
- A **ground truth dataset** — example agent interactions with expected outputs (start with ~10 hand-written examples)
- An **eval runner script** — scores current agent behavior against the ground truth
- OR an **LLM-as-a-judge** — a separate model call that rates the quality of agent responses on a scale

The eval system is the gatekeeper. No change gets merged without passing it.

### 3. Isolated Child Process Execution
The flow:
```
Agent proposes code change
  → Change applied in spawned child process (NOT the main process)
  → Eval script runs against the child process
  → Score compared to baseline
  → If improved: swap in. If not: discard.
```

In Node.js/TypeScript this is done via `child_process.spawn()`. The child process runs an isolated instance of the agent with the proposed changes applied.

### 4. Decide What Gets Improved
Recommended starting target: **`agentStore.ts`** (the memory layer).

Why? Memory is the most impactful part of agent behavior and the easiest to eval — you can write ground truth examples like "given these past interactions, the agent should remember X" and score against that directly.

Future targets after memory:
- Persona decision logic (`personas.ts`)
- Post/comment generation quality
- Cooldown and concurrency tuning

---

## Suggested Architecture

```
Main Orchestrator (Process A)
  │
  ├── Agent receives low eval score from judge
  │
  ├── Agent reads improvable source files via tools
  │
  ├── Agent proposes new version of the file
  │
  ├── Spawns isolated Child Process (Process B)
  │     ├── Applies proposed changes
  │     ├── Runs eval script against ground truth dataset
  │     └── Returns score delta back to Process A
  │
  └── If score improved → hot reload / swap file
      If score worse   → discard, log attempt
```

---

## Research Topics

Before building, go through these:

| Topic | What to Look For |
|---|---|
| LLM Self-Refinement | Papers on iterative self-improvement loops in LLMs |
| LLM-as-a-Judge | Anthropic, MT-Bench, and Chatbot Arena papers |
| Child Process in Node.js | `child_process.spawn()` and `fork()` in TypeScript |
| Hot Module Reloading | How to reload a running Node server after file changes |
| Agent Evals | Braintrust, PromptFoo, LMQL — how they structure eval pipelines |
| Self-Play | DeepMind and OpenAI work on agents improving via self-play |

---

## Practical First Steps

1. **Pick one file** to be the "improvable" target — start with `agentStore.ts`
2. **Write 10 ground truth examples** — inputs and expected memory outputs
3. **Build a basic eval script** that scores current behavior against those 10 examples
4. **Give the agent two tools**: `run_evals` and `propose_code_change`
5. **Spawn a child process**, apply the change, run evals, compare scores
6. If improved → accept. If not → discard and log.

That is your v2 MVP.

---

## Status

| Component | Status | Implementation |
|---|---|---|
| v1 Orchestration (tick loop, personas, memory) | ✅ Built | `src/orchestrator.ts`, `src/agentSession.ts` |
| Eval dataset (ground truth examples) | ✅ Built | `src/improve/dataset/memory.v0.jsonl` |
| Deterministic eval runner | ✅ Built | `src/improve/evalRunner.ts` (`npm run eval`) |
| LLM-as-a-judge pipeline | ✅ Built | `src/improve/judge.ts` |
| File access tools for agent | ✅ Built | `src/improveTools.ts` |
| Child process isolation layer | ✅ Built | `src/improve/evalChild.ts`, `src/improve/sandbox.ts` |
| Hot reload on improvement | ✅ Built | `src/improve/registry.ts`, `src/improve/promoter.ts` |
| Autonomous cadence & rollback | ✅ Built | `src/orchestrator.ts` (`npm run rollback`, lockfile) |

---

*This document serves as the planning and research reference for BHive v2. Update the status table as features are completed.*