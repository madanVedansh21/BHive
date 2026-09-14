// =============================================================================
// src/improve/evalRunner.ts — Deterministic offline eval harness.
//
// Usage:
//   npm run eval
//
// What it does:
//   1. Loads ground-truth cases from src/improve/dataset/memory.v0.jsonl
//   2. Runs each case against the live strategy in src/strategies/memory/default.ts
//   3. Scores each assertion (0 or 1)
//   4. Prints a report and saves the score to improvement/state/memory.json
//
// This is the gatekeeper — no proposed change is accepted unless it beats
// the baseline score recorded here.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { loadStrategy } from "./registry";
import { AgentMemory, AgentIdentity } from "../types";
import { TickMemoryPatch } from "./types";

// ---------------------------------------------------------------------------
// Dataset types
// ---------------------------------------------------------------------------

export interface AssertionSpec {
  type:
    | "postedByMeLength"
    | "postedByMeContains"
    | "commentedByMeLength"
    | "commentedByMeContains"
    | "postCooldownSet"
    | "notificationsLength"
    | "notificationsUnique"
    | "notificationRead"
    | "contextContains"
    | "contextNotContains";
  value?: number | boolean | string;
  postId?: string;
  commentId?: string;
  notificationId?: string;
}

export interface EvalCase {
  id: string;
  description: string;
  tags?: string[];
  type: "applyTick" | "buildContext";
  input: {
    memory: AgentMemory;
    toolCallRecords?: Array<{
      toolName: string;
      args: Record<string, unknown>;
      result: unknown;
      isError: boolean;
    }>;
    identity?: AgentIdentity;
  };
  expected: {
    assertions: AssertionSpec[];
  };
}

export interface AssertionResult {
  type: string;
  pass: boolean;
  reason: string;
}

export interface CaseResult {
  caseId: string;
  description: string;
  pass: boolean;
  score: number; // 0.0 – 1.0
  assertions: AssertionResult[];
  error?: string;
}

export interface EvalRunResult {
  score: number; // 0.0 – 1.0 (weighted mean of all case scores)
  passedCases: number;
  failedCases: number;
  totalCases: number;
  cases: CaseResult[];
  ranAt: string;
}

// ---------------------------------------------------------------------------
// Dataset loader
// ---------------------------------------------------------------------------

async function loadDataset(datasetPath: string): Promise<EvalCase[]> {
  const cases: EvalCase[] = [];
  const fileStream = fs.createReadStream(datasetPath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      cases.push(JSON.parse(trimmed) as EvalCase);
    }
  }
  return cases;
}

// ---------------------------------------------------------------------------
// Assertion evaluators
// ---------------------------------------------------------------------------

function runAssertion(
  assertion: AssertionSpec,
  patch: TickMemoryPatch | null,
  contextOutput: string | null
): AssertionResult {
  const { type } = assertion;

  // applyTick assertions — operate on the TickMemoryPatch
  if (patch !== null) {
    const mem = patch.memory;

    if (type === "postedByMeLength") {
      const actual = mem.postedByMe.length;
      const pass = actual === assertion.value;
      return { type, pass, reason: `postedByMe.length = ${actual}, expected ${assertion.value}` };
    }

    if (type === "postedByMeContains") {
      const pass = mem.postedByMe.some((p) => p.postId === assertion.postId);
      return { type, pass, reason: `postedByMe ${pass ? "contains" : "missing"} postId "${assertion.postId}"` };
    }

    if (type === "commentedByMeLength") {
      const actual = mem.commentedByMe.length;
      const pass = actual === assertion.value;
      return { type, pass, reason: `commentedByMe.length = ${actual}, expected ${assertion.value}` };
    }

    if (type === "commentedByMeContains") {
      const pass = mem.commentedByMe.some(
        (c) => c.commentId === assertion.commentId && c.postId === assertion.postId
      );
      return {
        type,
        pass,
        reason: `commentedByMe ${pass ? "contains" : "missing"} commentId "${assertion.commentId}" on postId "${assertion.postId}"`,
      };
    }

    if (type === "postCooldownSet") {
      const pass = patch.postCooldownSet === assertion.value;
      return { type, pass, reason: `postCooldownSet = ${patch.postCooldownSet}, expected ${assertion.value}` };
    }

    if (type === "notificationsLength") {
      const actual = mem.notifications.length;
      const pass = actual === assertion.value;
      return { type, pass, reason: `notifications.length = ${actual}, expected ${assertion.value}` };
    }

    if (type === "notificationsUnique") {
      const ids = mem.notifications.map((n) => n.id);
      const uniqueIds = new Set(ids);
      const pass = ids.length === uniqueIds.size;
      return {
        type,
        pass,
        reason: pass ? "All notification ids are unique" : `Duplicate ids found: ${ids.join(", ")}`,
      };
    }

    if (type === "notificationRead") {
      const n = mem.notifications.find((x) => x.id === assertion.notificationId);
      if (!n) {
        return { type, pass: false, reason: `Notification "${assertion.notificationId}" not found in memory` };
      }
      const pass = n.read === assertion.value;
      return { type, pass, reason: `notification "${assertion.notificationId}".read = ${n.read}, expected ${assertion.value}` };
    }
  }

  // buildContext assertions — operate on the string output
  if (contextOutput !== null) {
    if (type === "contextContains") {
      const needle = String(assertion.value ?? "");
      const pass = contextOutput.includes(needle);
      return { type, pass, reason: `Context ${pass ? "contains" : "does NOT contain"} "${needle}"` };
    }

    if (type === "contextNotContains") {
      const needle = String(assertion.value ?? "");
      const pass = !contextOutput.includes(needle);
      return { type, pass, reason: `Context ${pass ? "does not contain" : "UNEXPECTEDLY contains"} "${needle}"` };
    }
  }

  return { type, pass: false, reason: `Unknown assertion type "${type}" or wrong test type` };
}

// ---------------------------------------------------------------------------
// Run a single eval case
// ---------------------------------------------------------------------------

function runCase(evalCase: EvalCase): CaseResult {
  const strategy = loadStrategy("memory");
  let patch: TickMemoryPatch | null = null;
  let contextOutput: string | null = null;

  try {
    if (evalCase.type === "applyTick") {
      const records = (evalCase.input.toolCallRecords ?? []) as Parameters<
        typeof strategy.applyTickToMemory
      >[1];
      // Deep clone memory so strategy can mutate it freely
      const memoryCopy: AgentMemory = JSON.parse(JSON.stringify(evalCase.input.memory));
      patch = strategy.applyTickToMemory(memoryCopy, records);
    } else if (evalCase.type === "buildContext") {
      const identity = evalCase.input.identity!;
      const memoryCopy: AgentMemory = JSON.parse(JSON.stringify(evalCase.input.memory));
      contextOutput = strategy.buildContext(memoryCopy, identity);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      caseId: evalCase.id,
      description: evalCase.description,
      pass: false,
      score: 0,
      assertions: [],
      error: `Strategy threw: ${msg}`,
    };
  }

  const assertionResults = evalCase.expected.assertions.map((a) =>
    runAssertion(a, patch, contextOutput)
  );

  const passedAssertions = assertionResults.filter((a) => a.pass).length;
  const score = assertionResults.length > 0 ? passedAssertions / assertionResults.length : 1;
  const pass = passedAssertions === assertionResults.length;

  return {
    caseId: evalCase.id,
    description: evalCase.description,
    pass,
    score,
    assertions: assertionResults,
  };
}

// ---------------------------------------------------------------------------
// Main eval runner
// ---------------------------------------------------------------------------

export async function runEval(datasetPath: string): Promise<EvalRunResult> {
  const cases = await loadDataset(datasetPath);
  const caseResults = cases.map((c) => runCase(c));

  const totalCases = caseResults.length;
  const passedCases = caseResults.filter((r) => r.pass).length;
  const failedCases = totalCases - passedCases;
  const score = totalCases > 0
    ? caseResults.reduce((acc, r) => acc + r.score, 0) / totalCases
    : 0;

  return {
    score,
    passedCases,
    failedCases,
    totalCases,
    cases: caseResults,
    ranAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// CLI entry point: npm run eval
// ---------------------------------------------------------------------------

async function main() {
  const datasetPath = path.resolve(__dirname, "dataset", "memory.v0.jsonl");
  const stateDir = path.resolve(process.cwd(), "improvement", "state");
  const statePath = path.join(stateDir, "memory.json");

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  BHive v2 — Memory Strategy Eval Runner");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Dataset : ${datasetPath}`);
  console.log("");

  const result = await runEval(datasetPath);

  // Print per-case results
  for (const c of result.cases) {
    const mark = c.pass ? " PASS " : " FAIL ";
    console.log(`  [${mark}] ${c.caseId}: ${c.description}`);
    if (c.error) {
      console.log(`          ✗ Error: ${c.error}`);
    }
    for (const a of c.assertions) {
      const sym = a.pass ? "✓" : "✗";
      if (!a.pass) {
        console.log(`          ${sym} [${a.type}] ${a.reason}`);
      }
    }
  }

  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Score   : ${(result.score * 100).toFixed(1)}%`);
  console.log(`  Passed  : ${result.passedCases} / ${result.totalCases}`);
  console.log(`  Failed  : ${result.failedCases}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Load previous baseline for comparison
  if (fs.existsSync(statePath)) {
    const prev = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    const delta = result.score - prev.baseline;
    const sign = delta >= 0 ? "+" : "";
    console.log(`  vs baseline v${prev.version}: ${sign}${(delta * 100).toFixed(1)}%`);
  }
  console.log("");

  // Save/update state file
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  const existingState = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, "utf-8"))
    : null;

  const newState = {
    target: "memory",
    version: existingState?.version ?? 1,
    baseline: result.score,
    samples: result.totalCases,
    updatedAt: result.ranAt,
  };

  fs.writeFileSync(statePath, JSON.stringify(newState, null, 2), "utf-8");
  console.log(`  State saved → ${statePath}`);
  console.log("");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[EvalRunner] Fatal error:", err);
    process.exit(1);
  });
}
