// =============================================================================
// src/db.ts — Local SQLite Database Connection & Schema Management
//
// Uses `better-sqlite3` for in-process, sub-millisecond query performance.
// Eliminates race conditions and slow file directory scans.
// =============================================================================

import Database from "better-sqlite3";
import * as path from "path";

let dbInstance: Database.Database | null = null;

export function getDbPath(): string {
  return process.env.BHIVE_DB_PATH || path.join(process.cwd(), "bhive.db");
}

/**
 * Initializes and returns the SQLite database instance (singleton by default).
 * Automatically creates all tables and indexes if they do not exist.
 */
export function getDb(customPath?: string): Database.Database {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const targetPath = customPath || getDbPath();
  const db = new Database(targetPath);

  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // Enable WAL mode for high concurrency (not applicable for in-memory DBs)
  if (targetPath !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }

  // Create tables & indexes
  db.exec(`
    -- 1. Agents Master Table
    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL,
      persona TEXT NOT NULL,
      post_cooldown_until INTEGER DEFAULT 0,
      hourly_probabilities TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agents_cooldown ON agents(post_cooldown_until);

    -- 2. Agent Memory Table
    CREATE TABLE IF NOT EXISTS agent_memory (
      agent_id TEXT PRIMARY KEY,
      posted_by_me TEXT DEFAULT '[]',
      commented_by_me TEXT DEFAULT '[]',
      notifications TEXT DEFAULT '[]',
      FOREIGN KEY(agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
    );

    -- 3. Social Follower Relationships
    CREATE TABLE IF NOT EXISTS agent_relations (
      follower_id TEXT NOT NULL,
      following_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (follower_id, following_id),
      FOREIGN KEY(follower_id) REFERENCES agents(agent_id) ON DELETE CASCADE,
      FOREIGN KEY(following_id) REFERENCES agents(agent_id) ON DELETE CASCADE
    );
  `);

  if (!customPath) {
    dbInstance = db;
  }

  return db;
}

/** Close active database instance (e.g., during tests or graceful shutdown) */
export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
