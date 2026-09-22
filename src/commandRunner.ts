// =============================================================================
// src/commandRunner.ts — Process execution manager with real-time streaming.
//
// Allows web UI clients to trigger CLI commands (register, eval, improve,
// rollback, tick) and stream stdout/stderr chunks in real-time over eventBus.
// =============================================================================

import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import { bus } from "./eventBus";

interface ActiveProcess {
  commandId: string;
  cmd: string;
  label: string;
  process: ChildProcess;
  startedAt: number;
}

const activeProcesses = new Map<string, ActiveProcess>();

export interface CommandRequest {
  commandId: string;
  cmd: string;
  args?: string[];
  raw?: string;
}

// Map logical commands to safe execution specs
function resolveCommand(req: CommandRequest): { executable: string; args: string[]; label: string } {
  const tsNode = require.resolve("ts-node/register");
  const node = process.execPath; // current node binary

  switch (req.cmd) {
    case "eval":
      return {
        executable: node,
        args: ["--require", tsNode, path.resolve(process.cwd(), "src/improve/evalRunner.ts")],
        label: "npm run eval (ground truth test suite)",
      };

    case "register": {
      const count = req.args?.[0] ?? "5";
      return {
        executable: node,
        args: ["--require", tsNode, path.resolve(process.cwd(), "src/register.ts"), "--count", count],
        label: `npm run register -- --count ${count}`,
      };
    }

    case "improve":
      return {
        executable: node,
        args: ["--require", tsNode, path.resolve(process.cwd(), "src/improve/improveSession.ts")],
        label: "npm run improve (autonomous improvement cycle)",
      };

    case "rollback": {
      const target = req.args?.[0] ?? "memory";
      return {
        executable: node,
        args: ["--require", tsNode, path.resolve(process.cwd(), "src/improve/promoter.ts"), "rollback", "--target", target],
        label: `npm run rollback -- --target ${target}`,
      };
    }

    case "custom": {
      const input = (req.raw || "").trim();
      if (!input) throw new Error("Empty command");
      // Allowlist safety: only permit npm run, node, or git log
      const safePrefixes = ["npm run ", "npm test", "git log", "git status"];
      const isSafe = safePrefixes.some((p) => input.startsWith(p));
      if (!isSafe) {
        throw new Error(`Command '${input}' is not permitted. Allowed: npm run <script>, git log, git status.`);
      }
      return {
        executable: process.platform === "win32" ? "cmd.exe" : "sh",
        args: process.platform === "win32" ? ["/c", input] : ["-c", input],
        label: input,
      };
    }

    default:
      throw new Error(`Unknown command '${req.cmd}'. Allowed: eval, register, improve, rollback, custom.`);
  }
}

export function executeCommand(req: CommandRequest): void {
  const { commandId } = req;

  // Prevent duplicate execution of same commandId
  if (activeProcesses.has(commandId)) {
    throw new Error(`Command '${commandId}' is already running.`);
  }

  let spec: { executable: string; args: string[]; label: string };
  try {
    spec = resolveCommand(req);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    bus.publish("command:started", {
      commandId,
      cmd: req.cmd,
      label: req.cmd,
      startedAt: new Date().toISOString(),
    });
    bus.publish("command:output", {
      commandId,
      stream: "stderr",
      text: `Error: ${errorMsg}\n`,
    });
    bus.publish("command:ended", {
      commandId,
      exitCode: 1,
      durationMs: 0,
    });
    return;
  }

  const startTime = Date.now();

  // Publish command:started
  bus.publish("command:started", {
    commandId,
    cmd: req.cmd,
    label: spec.label,
    startedAt: new Date(startTime).toISOString(),
  });

  const child = spawn(spec.executable, spec.args, {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "1" },
    shell: false,
  });

  activeProcesses.set(commandId, {
    commandId,
    cmd: req.cmd,
    label: spec.label,
    process: child,
    startedAt: startTime,
  });

  child.stdout?.on("data", (chunk: Buffer) => {
    bus.publish("command:output", {
      commandId,
      stream: "stdout",
      text: chunk.toString("utf-8"),
    });
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    bus.publish("command:output", {
      commandId,
      stream: "stderr",
      text: chunk.toString("utf-8"),
    });
  });

  const cleanup = (code: number | null) => {
    if (!activeProcesses.has(commandId)) return;
    activeProcesses.delete(commandId);
    const durationMs = Date.now() - startTime;
    bus.publish("command:ended", {
      commandId,
      exitCode: code ?? 0,
      durationMs,
    });
  };

  child.on("close", (code) => cleanup(code));
  child.on("error", (err) => {
    bus.publish("command:output", {
      commandId,
      stream: "stderr",
      text: `Process error: ${err.message}\n`,
    });
    cleanup(1);
  });
}

export function killCommand(commandId: string): boolean {
  const active = activeProcesses.get(commandId);
  if (!active) return false;

  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(active.process.pid), "/f", "/t"]);
    } else {
      active.process.kill("SIGKILL");
    }
  } catch {
    // ignore
  }

  activeProcesses.delete(commandId);
  bus.publish("command:output", {
    commandId,
    stream: "stderr",
    text: `\n[Process terminated by user]\n`,
  });
  bus.publish("command:ended", {
    commandId,
    exitCode: 130,
    durationMs: Date.now() - active.startedAt,
  });
  return true;
}

export function getActiveCommands(): Array<{ commandId: string; cmd: string; label: string; durationMs: number }> {
  const now = Date.now();
  return Array.from(activeProcesses.values()).map((p) => ({
    commandId: p.commandId,
    cmd: p.cmd,
    label: p.label,
    durationMs: now - p.startedAt,
  }));
}
