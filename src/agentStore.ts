// =============================================================================
// src/agentStore.ts — SQLite-backed persistence for agent state.
//
// Powered by `better-sqlite3` via `src/db.ts` for fast, atomic transactions.
// =============================================================================

import * as path from "path";
import { getDb } from "./db";
import { AgentData, AgentMemory } from "./types";

/** Kept for backwards compatibility and fallback reference */
export const agentsDir = path.join(process.cwd(), "agents");

/** Load an agent's state from SQLite database. Throws if not found. */
export function loadAgent(agentId: string): AgentData {
  const db = getDb();
  const row = db.prepare(`
    SELECT 
      a.agent_id, a.name, a.api_key, a.persona, a.post_cooldown_until, a.hourly_probabilities, a.created_at,
      m.posted_by_me, m.commented_by_me, m.notifications
    FROM agents a
    LEFT JOIN agent_memory m ON a.agent_id = m.agent_id
    WHERE a.agent_id = ?
  `).get(agentId) as {
    agent_id: string;
    name: string;
    api_key: string;
    persona: string;
    post_cooldown_until: number;
    hourly_probabilities: string | null;
    created_at: string;
    posted_by_me: string | null;
    commented_by_me: string | null;
    notifications: string | null;
  } | undefined;

  if (!row) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  let hourlyProbabilities: number[] | undefined;
  if (row.hourly_probabilities) {
    try {
      hourlyProbabilities = JSON.parse(row.hourly_probabilities);
    } catch {
      hourlyProbabilities = undefined;
    }
  }

  let postedByMe = [];
  if (row.posted_by_me) {
    try { postedByMe = JSON.parse(row.posted_by_me); } catch {}
  }

  let commentedByMe = [];
  if (row.commented_by_me) {
    try { commentedByMe = JSON.parse(row.commented_by_me); } catch {}
  }

  let notifications = [];
  if (row.notifications) {
    try { notifications = JSON.parse(row.notifications); } catch {}
  }

  return {
    identity: {
      agentId: row.agent_id,
      name: row.name,
      apiKey: row.api_key,
      persona: row.persona,
      createdAt: row.created_at,
      postCooldownUntil: row.post_cooldown_until ?? 0,
      hourlyActivityProbabilities: hourlyProbabilities,
    },
    memory: {
      postedByMe,
      commentedByMe,
      notifications,
    },
  };
}

/** Write agent state to SQLite database atomically in a single transaction. */
export function saveAgent(agentData: AgentData): void {
  const db = getDb();

  const insertAgent = db.prepare(`
    INSERT INTO agents (
      agent_id, name, api_key, persona, post_cooldown_until, hourly_probabilities, created_at
    ) VALUES (
      @agentId, @name, @apiKey, @persona, @postCooldownUntil, @hourlyProbabilities, @createdAt
    )
    ON CONFLICT(agent_id) DO UPDATE SET
      name = excluded.name,
      api_key = excluded.api_key,
      persona = excluded.persona,
      post_cooldown_until = excluded.post_cooldown_until,
      hourly_probabilities = excluded.hourly_probabilities,
      created_at = excluded.created_at;
  `);

  const insertMemory = db.prepare(`
    INSERT INTO agent_memory (
      agent_id, posted_by_me, commented_by_me, notifications
    ) VALUES (
      @agentId, @postedByMe, @commentedByMe, @notifications
    )
    ON CONFLICT(agent_id) DO UPDATE SET
      posted_by_me = excluded.posted_by_me,
      commented_by_me = excluded.commented_by_me,
      notifications = excluded.notifications;
  `);

  const saveTx = db.transaction(() => {
    insertAgent.run({
      agentId: agentData.identity.agentId,
      name: agentData.identity.name,
      apiKey: agentData.identity.apiKey,
      persona: agentData.identity.persona,
      postCooldownUntil: agentData.identity.postCooldownUntil ?? 0,
      hourlyProbabilities: agentData.identity.hourlyActivityProbabilities
        ? JSON.stringify(agentData.identity.hourlyActivityProbabilities)
        : null,
      createdAt: agentData.identity.createdAt || new Date().toISOString(),
    });

    insertMemory.run({
      agentId: agentData.identity.agentId,
      postedByMe: JSON.stringify(agentData.memory?.postedByMe ?? []),
      commentedByMe: JSON.stringify(agentData.memory?.commentedByMe ?? []),
      notifications: JSON.stringify(agentData.memory?.notifications ?? []),
    });
  });

  saveTx();
}

/** Return array of all known agentIds from SQLite database. */
export function listAgentIds(): string[] {
  const db = getDb();
  const rows = db.prepare("SELECT agent_id FROM agents").all() as { agent_id: string }[];
  return rows.map((r) => r.agent_id);
}

/** Check whether an agent exists in SQLite database. */
export function agentExists(agentId: string): boolean {
  const db = getDb();
  const row = db.prepare("SELECT 1 FROM agents WHERE agent_id = ?").get(agentId);
  return Boolean(row);
}

/** Fast query returning all agent IDs whose post cooldown has elapsed (post_cooldown_until <= now). */
export function getEligibleAgentIds(now: number): string[] {
  const db = getDb();
  const rows = db.prepare("SELECT agent_id FROM agents WHERE post_cooldown_until <= ?").all(now) as { agent_id: string }[];
  return rows.map((r) => r.agent_id);
}

/** Return an empty memory object for a freshly registered agent. */
export function emptyMemory(): AgentMemory {
  return {
    postedByMe: [],
    commentedByMe: [],
    notifications: [],
  };
}
