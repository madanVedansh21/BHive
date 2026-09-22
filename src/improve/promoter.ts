// =============================================================================
// src/improve/promoter.ts — Promotion, Archiving, Atomic Swap & Rollback.
//
// Responsibilities:
//   • Evaluates candidate against baseline + ACCEPT_MARGIN
//   • On accept:
//       1. Archives current code to improvement/archive/{target}/v{N}.ts
//       2. Atomically swaps candidate into src/strategies/{target}/default.ts
//       3. Bumps version and updates improvement/state/{target}.json
//       4. Evicts require.cache so next orchestrator tick uses new code
//       5. Appends record to improvement/history.jsonl
//   • On reject:
//       1. Logs rejection and rationale to improvement/history.jsonl
//   • Rollback:
//       1. Restores previous version from improvement/archive/{target}/
//       2. Atomic swap + cache-bust + state update + history audit
// =============================================================================

import { bus } from "../eventBus";
import * as fs from "fs";
import * as path from "path";
import { ImprovableTarget, isAllowedTarget, loadStrategy } from "./registry";

// ---------------------------------------------------------------------------
// Paths & Config
// ---------------------------------------------------------------------------

const STRATEGIES_ROOT = path.resolve(__dirname, "..", "strategies");
const IMPROVEMENT_ROOT = path.resolve(process.cwd(), "improvement");
const STATE_DIR = path.join(IMPROVEMENT_ROOT, "state");
const ARCHIVE_DIR = path.join(IMPROVEMENT_ROOT, "archive");
const HISTORY_FILE = path.join(IMPROVEMENT_ROOT, "history.jsonl");
const PENDING_DIR = path.join(IMPROVEMENT_ROOT, "pending");

const ACCEPT_MARGIN = parseFloat(process.env.ACCEPT_MARGIN ?? "0.05");
const REQUIRE_HUMAN_APPROVAL = process.env.REQUIRE_HUMAN_APPROVAL === "true";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PromotionDecision = "accepted" | "rejected" | "held_for_review";

export interface StrategyState {
  target: ImprovableTarget;
  version: number;
  baseline: number;
  samples: number;
  updatedAt: string;
}

export interface PromoteOptions {
  target: ImprovableTarget;
  candidateContent: string;
  candidateScore: number;
  rationale: string;
  detail?: string;
  proposalId?: string;
}

export interface PromotionResult {
  decision: PromotionDecision;
  target: ImprovableTarget;
  version: number;
  baselineScore: number;
  candidateScore: number;
  delta: number;
  rationale: string;
  archivedPath?: string;
  message: string;
}

export interface HistoryEntry {
  timestamp: string;
  target: ImprovableTarget;
  decision: PromotionDecision | "rollback";
  version: number;
  baseline: number;
  candidate?: number;
  delta?: number;
  rationale: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// State and Directory Helpers
// ---------------------------------------------------------------------------

function ensureDirs(target: ImprovableTarget): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(path.join(ARCHIVE_DIR, target), { recursive: true });
  fs.mkdirSync(PENDING_DIR, { recursive: true });
}

export function getState(target: ImprovableTarget): StrategyState {
  ensureDirs(target);
  const statePath = path.join(STATE_DIR, `${target}.json`);
  if (fs.existsSync(statePath)) {
    try {
      return JSON.parse(fs.readFileSync(statePath, "utf-8")) as StrategyState;
    } catch {
      // Fall through to default
    }
  }
  return {
    target,
    version: 1,
    baseline: 1.0,
    samples: 10,
    updatedAt: new Date().toISOString(),
  };
}

function saveState(state: StrategyState): void {
  ensureDirs(state.target);
  const statePath = path.join(STATE_DIR, `${state.target}.json`);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

function appendHistory(entry: HistoryEntry): void {
  fs.mkdirSync(IMPROVEMENT_ROOT, { recursive: true });
  fs.appendFileSync(HISTORY_FILE, JSON.stringify(entry) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Core: Promote Proposal
// ---------------------------------------------------------------------------

export async function promoteProposal(options: PromoteOptions): Promise<PromotionResult> {
  const { target, candidateContent, candidateScore, rationale, detail, proposalId } = options;

  if (!isAllowedTarget(target)) {
    throw new Error(`Invalid target: ${target}`);
  }

  ensureDirs(target);
  const currentState = getState(target);
  const baseline = currentState.baseline;
  const delta = candidateScore - baseline;

  // Acceptance rule:
  // Must meet candidateScore >= baseline + ACCEPT_MARGIN OR candidateScore === 1.0 if baseline was < 1.0
  const satisfiesImprovement = candidateScore >= baseline + ACCEPT_MARGIN || (candidateScore === 1.0 && delta > 0);

  if (!satisfiesImprovement) {
    const historyEntry: HistoryEntry = {
      timestamp: new Date().toISOString(),
      target,
      decision: "rejected",
      version: currentState.version,
      baseline,
      candidate: candidateScore,
      delta,
      rationale,
      detail,
    };
    appendHistory(historyEntry);

    bus.publish("improvement:decision", {
      decision: "rejected",
      target,
      version: currentState.version,
      baselineScore: baseline,
      candidateScore,
      delta,
      rationale,
      message: `Proposal rejected: delta (${(delta * 100).toFixed(1)}%) did not meet ACCEPT_MARGIN (+${(ACCEPT_MARGIN * 100).toFixed(1)}%).`,
    });

    return {
      decision: "rejected",
      target,
      version: currentState.version,
      baselineScore: baseline,
      candidateScore,
      delta,
      rationale,
      message: `Proposal rejected: delta (${(delta * 100).toFixed(1)}%) did not meet ACCEPT_MARGIN (+${(ACCEPT_MARGIN * 100).toFixed(1)}%).`,
    };
  }

  // Check if human approval is enforced
  if (REQUIRE_HUMAN_APPROVAL) {
    const pendingId = proposalId ?? `prop_${Date.now()}`;
    const pendingFile = path.join(PENDING_DIR, `${target}_${pendingId}.json`);
    const pendingPayload = {
      target,
      proposalId: pendingId,
      candidateContent,
      candidateScore,
      baselineScore: baseline,
      delta,
      rationale,
      detail,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(pendingFile, JSON.stringify(pendingPayload, null, 2), "utf-8");

    const historyEntry: HistoryEntry = {
      timestamp: new Date().toISOString(),
      target,
      decision: "held_for_review",
      version: currentState.version,
      baseline,
      candidate: candidateScore,
      delta,
      rationale,
      detail: `Held in ${pendingFile}`,
    };
    appendHistory(historyEntry);

    return {
      decision: "held_for_review",
      target,
      version: currentState.version,
      baselineScore: baseline,
      candidateScore,
      delta,
      rationale,
      message: `Proposal passed evaluation (+${(delta * 100).toFixed(1)}%) but REQUIRE_HUMAN_APPROVAL is enabled. Queued in ${pendingFile}.`,
    };
  }

  // 1. Archive current active code
  const targetDir = path.join(STRATEGIES_ROOT, target);
  const liveFilePath = path.join(targetDir, "default.ts");
  const archivePath = path.join(ARCHIVE_DIR, target, `v${currentState.version}.ts`);

  if (fs.existsSync(liveFilePath)) {
    const currentCode = fs.readFileSync(liveFilePath, "utf-8");
    fs.writeFileSync(archivePath, currentCode, "utf-8");
  }

  // 2. Atomic swap: write candidate to temp file then renameSync
  const tmpPath = path.join(targetDir, "default.ts.tmp");
  fs.writeFileSync(tmpPath, candidateContent, "utf-8");
  fs.renameSync(tmpPath, liveFilePath);

  // 3. Update state
  const newVersion = currentState.version + 1;
  const newState: StrategyState = {
    target,
    version: newVersion,
    baseline: candidateScore,
    samples: currentState.samples,
    updatedAt: new Date().toISOString(),
  };
  saveState(newState);

  // 4. Hot reload: bust require cache
  loadStrategy(target);

  // 5. Append to history log
  const historyEntry: HistoryEntry = {
    timestamp: new Date().toISOString(),
    target,
    decision: "accepted",
    version: newVersion,
    baseline,
    candidate: candidateScore,
    delta,
    rationale,
    detail,
  };
  appendHistory(historyEntry);

  bus.publish("improvement:decision", {
    decision: "accepted",
    target,
    version: newVersion,
    baselineScore: baseline,
    candidateScore,
    delta,
    rationale,
    message: `Proposal accepted! Promoted to v${newVersion} (+${(delta * 100).toFixed(1)}%).`,
  });

  return {
    decision: "accepted",
    target,
    version: newVersion,
    baselineScore: baseline,
    candidateScore,
    delta,
    rationale,
    archivedPath: archivePath,
    message: `Proposal accepted! Promoted to v${newVersion} (+${(delta * 100).toFixed(1)}%). Old version archived to ${path.basename(archivePath)}.`,
  };
}

// ---------------------------------------------------------------------------
// Rollback Strategy
// ---------------------------------------------------------------------------

export function rollbackStrategy(target: ImprovableTarget): string {
  if (!isAllowedTarget(target)) {
    throw new Error(`Invalid target: ${target}`);
  }

  ensureDirs(target);
  const currentState = getState(target);
  const targetArchiveDir = path.join(ARCHIVE_DIR, target);

  // Find available archived versions
  const archivedFiles = fs.existsSync(targetArchiveDir)
    ? fs
        .readdirSync(targetArchiveDir)
        .filter((f) => f.startsWith("v") && f.endsWith(".ts"))
        .map((f) => {
          const num = parseInt(f.replace(/^v/, "").replace(/\.ts$/, ""), 10);
          return { filename: f, version: num };
        })
        .filter((item) => !isNaN(item.version) && item.version < currentState.version)
        .sort((a, b) => b.version - a.version)
    : [];

  if (archivedFiles.length === 0) {
    throw new Error(`No earlier archived versions found for target "${target}" (current v${currentState.version}).`);
  }

  const prev = archivedFiles[0];
  const prevFilePath = path.join(targetArchiveDir, prev.filename);
  const prevCode = fs.readFileSync(prevFilePath, "utf-8");

  // Atomic swap previous code into live location
  const targetDir = path.join(STRATEGIES_ROOT, target);
  const liveFilePath = path.join(targetDir, "default.ts");
  const tmpPath = path.join(targetDir, "default.ts.tmp");

  fs.writeFileSync(tmpPath, prevCode, "utf-8");
  fs.renameSync(tmpPath, liveFilePath);

  // Update state
  const rolledBackState: StrategyState = {
    target,
    version: prev.version,
    baseline: 1.0, // reset to default floor
    samples: currentState.samples,
    updatedAt: new Date().toISOString(),
  };
  saveState(rolledBackState);

  // Invalidate cache
  loadStrategy(target);

  // Log to history
  appendHistory({
    timestamp: new Date().toISOString(),
    target,
    decision: "rollback",
    version: prev.version,
    baseline: currentState.baseline,
    rationale: `Manual rollback from v${currentState.version} to v${prev.version}`,
  });

  return `Successfully rolled back "${target}" from v${currentState.version} to v${prev.version}.`;
}

// ---------------------------------------------------------------------------
// CLI Interface
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "rollback") {
    let targetArg: ImprovableTarget = "memory";
    const targetIdx = args.indexOf("--target");
    if (targetIdx !== -1 && args[targetIdx + 1]) {
      targetArg = args[targetIdx + 1] as ImprovableTarget;
    }
    try {
      const msg = rollbackStrategy(targetArg);
      console.log(`[Promoter] ${msg}`);
    } catch (err: unknown) {
      console.error(`[Promoter] Rollback failed:`, err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  } else {
    console.log("Usage: node --require ts-node/register src/improve/promoter.ts rollback [--target memory]");
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[Promoter] Fatal:", err);
    process.exit(1);
  });
}
