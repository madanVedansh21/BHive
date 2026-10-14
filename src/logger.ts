// =============================================================================
// src/logger.ts — File-based JSON logging for agent reasoning, traces, and events
//
// Automatically persists:
//   - All bus events to logs/events.jsonl (line-delimited JSON)
//   - Per-agent full reasoning traces to logs/reasoning/{agentId}.jsonl
//   - Latest tick reasoning to logs/reasoning/latest.json
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { bus } from "./eventBus";
import { BHiveEvent } from "./uiTypes";

const LOGS_DIR = path.resolve(process.cwd(), "logs");
const REASONING_DIR = path.resolve(LOGS_DIR, "reasoning");
const EVENTS_FILE = path.resolve(LOGS_DIR, "events.jsonl");

function ensureDirs(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
  if (!fs.existsSync(REASONING_DIR)) {
    fs.mkdirSync(REASONING_DIR, { recursive: true });
  }
}

export interface AgentTickTrace {
  id: string;
  timestamp: string;
  tickIndex: number;
  agentId: string;
  name: string;
  contextPrompt: string;
  steps: Array<{
    step: number;
    thinking: string;
    toolCall?: { toolName: string; args: Record<string, unknown> };
    toolResult?: string;
    isError?: boolean;
  }>;
  finishSummary?: string;
  durationMs: number;
  toolCallCount: number;
}

/** Append an event to logs/events.jsonl */
export function logEvent(event: BHiveEvent): void {
  try {
    ensureDirs();
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + "\n", "utf-8");
  } catch (err) {
    console.error("[Logger] Failed to write event log:", err);
  }
}

/** Save full reasoning trace for an agent tick */
export function saveAgentReasoningTrace(trace: AgentTickTrace): void {
  try {
    ensureDirs();
    const agentLogFile = path.resolve(REASONING_DIR, `${trace.agentId}.jsonl`);
    const line = JSON.stringify(trace) + "\n";
    fs.appendFileSync(agentLogFile, line, "utf-8");

    // Also update latest.json for quick one-click inspection
    const latestFile = path.resolve(REASONING_DIR, "latest.json");
    fs.writeFileSync(latestFile, JSON.stringify(trace, null, 2), "utf-8");
  } catch (err) {
    console.error("[Logger] Failed to save agent reasoning trace:", err);
  }
}

/** Read recent events from logs/events.jsonl */
export function getRecentEvents(limit: number = 100): BHiveEvent[] {
  try {
    if (!fs.existsSync(EVENTS_FILE)) return [];
    const lines = fs
      .readFileSync(EVENTS_FILE, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);
    const slice = lines.slice(-limit);
    return slice
      .map((l) => {
        try {
          return JSON.parse(l) as BHiveEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is BHiveEvent => e !== null);
  } catch {
    return [];
  }
}

/** Read recent reasoning traces for an agent or all agents */
export function getRecentReasoning(agentId?: string, limit: number = 20): AgentTickTrace[] {
  try {
    ensureDirs();
    if (agentId) {
      const file = path.resolve(REASONING_DIR, `${agentId}.jsonl`);
      if (!fs.existsSync(file)) return [];
      const lines = fs.readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
      return lines
        .slice(-limit)
        .map((l) => {
          try {
            return JSON.parse(l) as AgentTickTrace;
          } catch {
            return null;
          }
        })
        .filter((t): t is AgentTickTrace => t !== null)
        .reverse();
    }

    // Otherwise read latest from all agents
    const files = fs.readdirSync(REASONING_DIR).filter((f) => f.endsWith(".jsonl"));
    const allTraces: AgentTickTrace[] = [];
    for (const f of files) {
      const fullPath = path.resolve(REASONING_DIR, f);
      const lines = fs.readFileSync(fullPath, "utf-8").trim().split("\n").filter(Boolean);
      for (const line of lines.slice(-5)) {
        try {
          allTraces.push(JSON.parse(line));
        } catch {
          // ignore
        }
      }
    }

    allTraces.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return allTraces.slice(0, limit);
  } catch {
    return [];
  }
}

let initialized = false;

/** Initialize the logger subscription to eventBus */
export function initLogger(): void {
  if (initialized) return;
  initialized = true;
  ensureDirs();
  bus.onEvent((event) => {
    logEvent(event);
  });
}
