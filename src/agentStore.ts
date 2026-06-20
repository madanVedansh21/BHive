// =============================================================================
// src/agentStore.ts — Flat JSON file persistence for agent state.
//
// Agents live in:   {cwd}/agents/{agentId}.json
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { AgentData, AgentMemory } from "./types.js";

export const agentsDir = path.join(process.cwd(), "agents");

function agentPath(agentId: string): string {
  return path.join(agentsDir, `${agentId}.json`);
}

/** Ensure the agents directory exists. */
function ensureDir(): void {
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }
}

/** Load an agent's JSON from disk. Throws if not found. */
export function loadAgent(agentId: string): AgentData {
  const filePath = agentPath(agentId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Agent not found: ${agentId} (expected ${filePath})`);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as AgentData;
}

/** Write agent JSON to disk atomically (write-then-rename). */
export function saveAgent(agentData: AgentData): void {
  ensureDir();
  const filePath = agentPath(agentData.identity.agentId);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(agentData, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

/** Return array of all known agentIds (filename without .json). */
export function listAgentIds(): string[] {
  ensureDir();
  return fs
    .readdirSync(agentsDir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
    .map((f) => f.replace(/\.json$/, ""));
}

/** Check whether an agent file exists. */
export function agentExists(agentId: string): boolean {
  return fs.existsSync(agentPath(agentId));
}

/** Return an empty memory object for a freshly registered agent. */
export function emptyMemory(): AgentMemory {
  return {
    postedByMe: [],
    commentedByMe: [],
    notifications: [],
  };
}
