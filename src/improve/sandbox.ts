// =============================================================================
// src/improve/sandbox.ts — Isolated candidate evaluation via child_process.fork
//
// Flow for every proposal:
//   1. Validate path (allowlist + no ../ traversal)
//   2. Validate TypeScript syntax (tsc --noEmit on just the candidate)
//   3. Validate size cap (40 KB)
//   4. Copy src/strategies/{target}/ into a temp workspace
//   5. Overwrite target file with the candidate content
//   6. fork() evalChild.ts inside that workspace
//   7. Send RUN_EVAL over IPC, await EvalReport (timeout: SANDBOX_TIMEOUT_MS)
//   8. Kill child, delete workspace
//   9. Return SandboxResult to caller
//
// Safety:
//   • Main process is never touched by candidate code
//   • SIGKILL watchdog kills hung children (infinite loops ignore SIGTERM)
//   • All workspace cleanup happens in finally{} blocks — never left on disk
// =============================================================================

import { fork, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { ChildToParentMsg, ParentToChildMsg } from "./evalChild";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SANDBOX_TIMEOUT_MS = parseInt(process.env.SANDBOX_TOTAL_TIMEOUT_MS ?? "90000", 10);
const MAX_STRATEGY_BYTES = 40 * 1024; // 40 KB hard cap

// Paths resolved relative to this file's location at runtime
const SRC_STRATEGIES_ROOT = path.resolve(__dirname, "..", "strategies");
const DATASET_PATH = path.resolve(__dirname, "dataset", "memory.v0.jsonl");
const WORKSPACES_ROOT = path.resolve(process.cwd(), "improvement", "workspaces");
const EVAL_CHILD_PATH = path.resolve(__dirname, "evalChild");

// Allowed improvable targets
const ALLOWED_TARGETS = ["memory"] as const;
type ImprovableTarget = (typeof ALLOWED_TARGETS)[number];

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type SandboxVerdict = "ACCEPTED" | "REJECTED" | "SYNTAX_ERROR" | "TIMEOUT" | "CRASH";

export interface SandboxResult {
  verdict: SandboxVerdict;
  score: number;          // 0.0-1.0 from evalChild
  passedCases: number;
  totalCases: number;
  detail: string;         // per-case PASS/FAIL log
  errorMessage?: string;  // populated on SYNTAX_ERROR / CRASH / TIMEOUT
}

// ---------------------------------------------------------------------------
// Helper: kill a child process gracefully, escalate to SIGKILL
// ---------------------------------------------------------------------------

function killChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    let forceKillTimer: NodeJS.Timeout | null = null;
    child.once("exit", () => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve();
    });
    child.kill("SIGTERM");
    forceKillTimer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
      resolve();
    }, 2000);
  });
}

// ---------------------------------------------------------------------------
// Helper: recursively copy a directory
// ---------------------------------------------------------------------------

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: validate the candidate TypeScript syntax using tsc
// Returns null on success, error string on failure
// ---------------------------------------------------------------------------

function validateSyntax(candidateFilePath: string): string | null {
  try {
    execSync(
      `npx tsc --noEmit --skipLibCheck --strict --target esnext --module commonjs "${candidateFilePath}"`,
      { stdio: "pipe", timeout: 15000 }
    );
    return null;
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
    const output = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
    return output.trim() || (e.message ?? "Unknown compile error");
  }
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function runInSandbox(
  target: ImprovableTarget,
  candidateContent: string,
  proposalId: string
): Promise<SandboxResult> {
  // ── 1. Validate target is allowlisted ──────────────────────────────────────
  if (!(ALLOWED_TARGETS as readonly string[]).includes(target)) {
    return {
      verdict: "REJECTED",
      score: 0,
      passedCases: 0,
      totalCases: 0,
      detail: "",
      errorMessage: `Target "${target}" is not in the allowlist: ${ALLOWED_TARGETS.join(", ")}`,
    };
  }

  // ── 2. Validate size cap ───────────────────────────────────────────────────
  const byteLength = Buffer.byteLength(candidateContent, "utf-8");
  if (byteLength > MAX_STRATEGY_BYTES) {
    return {
      verdict: "REJECTED",
      score: 0,
      passedCases: 0,
      totalCases: 0,
      detail: "",
      errorMessage: `Candidate content exceeds size cap (${byteLength} > ${MAX_STRATEGY_BYTES} bytes)`,
    };
  }

  // ── 3. Create workspace ────────────────────────────────────────────────────
  const workspaceDir = path.join(WORKSPACES_ROOT, proposalId);
  const workspaceStrategyDir = path.join(workspaceDir, "strategies", target);
  const workspaceStrategyPath = path.join(workspaceStrategyDir, "default.ts");

  fs.mkdirSync(workspaceDir, { recursive: true });

  // Copy the live strategies dir so imports still resolve
  copyDir(path.join(SRC_STRATEGIES_ROOT, target), workspaceStrategyDir);

  // Overwrite default.ts with candidate content
  fs.writeFileSync(workspaceStrategyPath, candidateContent, "utf-8");

  try {
    // ── 4. Syntax check (cheap, pre-fork) ─────────────────────────────────────
    const syntaxError = validateSyntax(workspaceStrategyPath);
    if (syntaxError) {
      return {
        verdict: "SYNTAX_ERROR",
        score: 0,
        passedCases: 0,
        totalCases: 0,
        detail: "",
        errorMessage: syntaxError,
      };
    }

    // ── 5. Fork the child process ──────────────────────────────────────────────
    const tsNodeRegister = require.resolve("ts-node/register");

    const child = fork(EVAL_CHILD_PATH, [], {
      execArgv: ["--require", tsNodeRegister, "--max-old-space-size=256"],
      silent: true,
      serialization: "advanced",
    });

    // Pipe child stderr so we can capture crash messages
    const childLogs: string[] = [];
    child.stderr?.on("data", (chunk: Buffer) => {
      childLogs.push(chunk.toString());
    });

    // Must attach error listener or parent crashes if child spawn fails
    child.on("error", (err) => {
      childLogs.push(`[child spawn error] ${err.message}`);
    });

    // ── 6. Race: IPC result vs timeout watchdog ────────────────────────────────
    const result = await new Promise<SandboxResult>((resolve) => {
      let settled = false;

      const settle = (r: SandboxResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdogTimer);
        resolve(r);
      };

      // Watchdog: parent kills stuck child with SIGKILL after timeout
      const watchdogTimer = setTimeout(async () => {
        await killChild(child);
        settle({
          verdict: "TIMEOUT",
          score: 0,
          passedCases: 0,
          totalCases: 0,
          detail: childLogs.join("\n"),
          errorMessage: `Sandbox timed out after ${SANDBOX_TIMEOUT_MS}ms`,
        });
      }, SANDBOX_TIMEOUT_MS);

      child.on("message", async (msg: ChildToParentMsg) => {
        if (msg.type === "EVAL_RESULT") {
          await killChild(child);
          settle({
            verdict: msg.score >= 0.98 ? "ACCEPTED" : "REJECTED",
            score: msg.score,
            passedCases: msg.passedCases,
            totalCases: msg.totalCases,
            detail: msg.detail,
          });
        } else if (msg.type === "FATAL_ERROR") {
          await killChild(child);
          settle({
            verdict: "CRASH",
            score: 0,
            passedCases: 0,
            totalCases: 0,
            detail: childLogs.join("\n"),
            errorMessage: `${msg.error.name}: ${msg.error.message}\n${msg.error.stack ?? ""}`,
          });
        }
      });

      child.on("exit", (code, signal) => {
        if (settled) return;
        settle({
          verdict: "CRASH",
          score: 0,
          passedCases: 0,
          totalCases: 0,
          detail: childLogs.join("\n"),
          errorMessage: `Child exited unexpectedly (code=${code}, signal=${signal})`,
        });
      });

      // Send RUN_EVAL to child
      const runMsg: ParentToChildMsg = {
        type: "RUN_EVAL",
        workspaceStrategyPath: workspaceStrategyPath,
        datasetPath: DATASET_PATH,
      };
      child.send(runMsg);
    });

    return result;
  } finally {
    // ── 7. Always clean up workspace regardless of outcome ─────────────────────
    try {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    } catch {
      // Non-fatal — log and continue
      console.warn(`[sandbox] Warning: could not clean workspace ${workspaceDir}`);
    }
  }
}
