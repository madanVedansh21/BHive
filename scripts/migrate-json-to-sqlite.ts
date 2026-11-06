// =============================================================================
// scripts/migrate-json-to-sqlite.ts — Import agents/*.json into SQLite
//
// Reads existing flat JSON files from `agents/` and migrates them into
// `bhive.db` tables (agents & agent_memory) using an atomic transaction.
//
// Usage: node --require ts-node/register scripts/migrate-json-to-sqlite.ts
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { getDb, closeDb } from "../src/db";
import { AgentData } from "../src/types";

async function migrate() {
  const agentsDir = path.join(process.cwd(), "agents");
  if (!fs.existsSync(agentsDir)) {
    console.log("No agents/ directory found. Nothing to migrate.");
    return;
  }

  const files = fs
    .readdirSync(agentsDir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"));

  if (files.length === 0) {
    console.log("No agent JSON files found in agents/.");
    return;
  }

  console.log(`Found ${files.length} agent JSON file(s) in ${agentsDir}. Starting migration to SQLite...\n`);

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

  let migratedCount = 0;

  const runMigration = db.transaction(() => {
    for (const file of files) {
      const filePath = path.join(agentsDir, file);
      const raw = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw) as AgentData;

      insertAgent.run({
        agentId: data.identity.agentId,
        name: data.identity.name,
        apiKey: data.identity.apiKey,
        persona: data.identity.persona,
        postCooldownUntil: data.identity.postCooldownUntil ?? 0,
        hourlyProbabilities: data.identity.hourlyActivityProbabilities
          ? JSON.stringify(data.identity.hourlyActivityProbabilities)
          : null,
        createdAt: data.identity.createdAt || new Date().toISOString(),
      });

      insertMemory.run({
        agentId: data.identity.agentId,
        postedByMe: JSON.stringify(data.memory?.postedByMe ?? []),
        commentedByMe: JSON.stringify(data.memory?.commentedByMe ?? []),
        notifications: JSON.stringify(data.memory?.notifications ?? []),
      });

      migratedCount++;
      console.log(`  ✅ Migrated: ${data.identity.name} (${data.identity.agentId})`);
    }
  });

  runMigration();

  // Verification count
  const countRow = db.prepare("SELECT COUNT(*) as count FROM agents").get() as { count: number };
  console.log(`\n🎉 Migration complete! ${migratedCount} agents imported.`);
  console.log(`📊 Total agents now in SQLite database: ${countRow.count}`);

  closeDb();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
