// =============================================================================
// src/improve/evalChild.ts — Entry point executed INSIDE Process B (fork).
//
// This file is forked by sandbox.ts via child_process.fork().
// It NEVER imports anything from the live orchestrator scope.
// Everything it needs is passed over IPC from the parent.
//
// Flow:
//   1. Parent forks this file with { workspaceDir, datasetPath } args
//   2. Child loads the CANDIDATE strategy from workspaceDir (not live src/)
//   3. Child runs evalRunner against the dataset
//   4. Child sends EvalReport back to parent over IPC
//   5. Child exits cleanly
//
// Crash protection:
//   • uncaughtException + unhandledRejection → send FATAL_ERROR then exit(1)
//   • Parent has a SIGKILL watchdog for infinite loops (IPC can't help there)
// =============================================================================

import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";

// ---------------------------------------------------------------------------
// IPC Protocol types (must match sandbox.ts exactly)
// ---------------------------------------------------------------------------

export type ParentToChildMsg =
  | { type: "RUN_EVAL"; workspaceStrategyPath: string; datasetPath: string }
  | { type: "SHUTDOWN" };

export type ChildToParentMsg =
  | { type: "EVAL_RESULT"; score: number; passedCases: number; totalCases: number; detail: string }
  | { type: "FATAL_ERROR"; error: { name: string; message: string; stack?: string } };

// ---------------------------------------------------------------------------
// Crash handlers — notify parent before dying
// ---------------------------------------------------------------------------

process.on("uncaughtException", (err: Error) => {
  process.send?.({
    type: "FATAL_ERROR",
    error: { name: err.name, message: err.message, stack: err.stack },
  } as ChildToParentMsg);
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  process.send?.({
    type: "FATAL_ERROR",
    error: { name: err.name, message: err.message, stack: err.stack },
  } as ChildToParentMsg);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Verify we are running under IPC (forked, not run directly)
// ---------------------------------------------------------------------------

if (!process.send) {
  console.error("[evalChild] Must be run as a forked process with IPC. Do not run directly.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Minimal inline types (cannot import from src/improve — different workspace)
// ---------------------------------------------------------------------------

interface AgentMemory {
  postedByMe: Array<{ postId: string; title: string; timestamp: string }>;
  commentedByMe: Array<{ commentId: string; postId: string; timestamp: string }>;
  notifications: Array<{ id: string; type: string; postId?: string; fromAgentId?: string; read: boolean }>;
}

interface AgentIdentity {
  agentId: string;
  name: string;
  apiKey: string;
  persona: string;
  createdAt: string;
  postCooldownUntil?: number;
}

interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  isError: boolean;
}

interface TickMemoryPatch {
  memory: AgentMemory;
  postCooldownSet: boolean;
}

interface MemoryStrategy {
  buildContext(memory: AgentMemory, identity: AgentIdentity): string;
  applyTickToMemory(memory: AgentMemory, records: ToolCallRecord[]): TickMemoryPatch;
}

interface AssertionSpec {
  type: string;
  value?: number | boolean | string;
  postId?: string;
  commentId?: string;
  notificationId?: string;
}

interface EvalCase {
  id: string;
  description: string;
  type: "applyTick" | "buildContext";
  input: {
    memory: AgentMemory;
    toolCallRecords?: ToolCallRecord[];
    identity?: AgentIdentity;
  };
  expected: { assertions: AssertionSpec[] };
}

// ---------------------------------------------------------------------------
// Dataset loader (inline — no dependency on src/improve/evalRunner)
// ---------------------------------------------------------------------------

async function loadDataset(datasetPath: string): Promise<EvalCase[]> {
  const cases: EvalCase[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(datasetPath),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const t = line.trim();
    if (t && !t.startsWith("#")) cases.push(JSON.parse(t));
  }
  return cases;
}

// ---------------------------------------------------------------------------
// Inline assertion runner (mirrors evalRunner.ts but standalone)
// ---------------------------------------------------------------------------

function runAssertion(
  a: AssertionSpec,
  patch: TickMemoryPatch | null,
  ctx: string | null
): boolean {
  if (patch) {
    const m = patch.memory;
    if (a.type === "postedByMeLength") return m.postedByMe.length === a.value;
    if (a.type === "postedByMeContains") return m.postedByMe.some((p) => p.postId === a.postId);
    if (a.type === "commentedByMeLength") return m.commentedByMe.length === a.value;
    if (a.type === "commentedByMeContains")
      return m.commentedByMe.some((c) => c.commentId === a.commentId && c.postId === a.postId);
    if (a.type === "postCooldownSet") return patch.postCooldownSet === a.value;
    if (a.type === "notificationsLength") return m.notifications.length === a.value;
    if (a.type === "notificationsUnique") {
      const ids = m.notifications.map((n) => n.id);
      return ids.length === new Set(ids).size;
    }
    if (a.type === "notificationRead") {
      const n = m.notifications.find((x) => x.id === a.notificationId);
      return n?.read === a.value;
    }
  }
  if (ctx !== null) {
    if (a.type === "contextContains") return ctx.includes(String(a.value ?? ""));
    if (a.type === "contextNotContains") return !ctx.includes(String(a.value ?? ""));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Run all eval cases against the candidate strategy
// ---------------------------------------------------------------------------

async function runEvalOnCandidate(
  strategy: MemoryStrategy,
  datasetPath: string
): Promise<{ score: number; passedCases: number; totalCases: number; detail: string }> {
  const cases = await loadDataset(datasetPath);
  let passed = 0;
  const lines: string[] = [];

  for (const c of cases) {
    let patch: TickMemoryPatch | null = null;
    let ctx: string | null = null;

    try {
      if (c.type === "applyTick") {
        const memCopy: AgentMemory = JSON.parse(JSON.stringify(c.input.memory));
        patch = strategy.applyTickToMemory(memCopy, c.input.toolCallRecords ?? []);
      } else {
        const memCopy: AgentMemory = JSON.parse(JSON.stringify(c.input.memory));
        ctx = strategy.buildContext(memCopy, c.input.identity!);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lines.push(`FAIL ${c.id}: threw ${msg}`);
      continue;
    }

    const results = c.expected.assertions.map((a) => runAssertion(a, patch, ctx));
    const casePass = results.every(Boolean);
    if (casePass) {
      passed++;
      lines.push(`PASS ${c.id}`);
    } else {
      lines.push(`FAIL ${c.id}: ${results.map((r, i) => (!r ? c.expected.assertions[i].type : null)).filter(Boolean).join(", ")}`);
    }
  }

  const total = cases.length;
  const score = total > 0 ? passed / total : 0;

  return { score, passedCases: passed, totalCases: total, detail: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// Main: listen for RUN_EVAL from parent
// ---------------------------------------------------------------------------

process.on("message", async (msg: ParentToChildMsg) => {
  if (msg.type === "SHUTDOWN") {
    process.disconnect?.();
    process.exit(0);
  }

  if (msg.type === "RUN_EVAL") {
    const { workspaceStrategyPath, datasetPath } = msg;

    // Load the CANDIDATE strategy from the temp workspace
    // Must bust require.cache in case this child somehow already loaded it
    try {
      const resolved = require.resolve(workspaceStrategyPath);
      delete require.cache[resolved];
    } catch {
      // file not cached yet — fine
    }

    let strategy: MemoryStrategy;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(workspaceStrategyPath);
      strategy = (mod.strategy ?? mod.default ?? mod) as MemoryStrategy;

      if (
        typeof strategy?.buildContext !== "function" ||
        typeof strategy?.applyTickToMemory !== "function"
      ) {
        throw new Error("Loaded module does not satisfy MemoryStrategy contract");
      }
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      process.send?.({
        type: "FATAL_ERROR",
        error: { name: e.name, message: e.message, stack: e.stack },
      } as ChildToParentMsg);
      process.exit(1);
      return;
    }

    try {
      const result = await runEvalOnCandidate(strategy, datasetPath);
      process.send?.({ type: "EVAL_RESULT", ...result } as ChildToParentMsg);
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      process.send?.({
        type: "FATAL_ERROR",
        error: { name: e.name, message: e.message, stack: e.stack },
      } as ChildToParentMsg);
      process.exit(1);
    }
  }
});
