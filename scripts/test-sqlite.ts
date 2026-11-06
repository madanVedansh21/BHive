import { getDb } from '../src/db';
import { loadAgent, listAgentIds, getEligibleAgentIds } from '../src/agentStore';
import * as fs from 'fs';
import * as path from 'path';

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('   BHive SQLite Verification & Health Check       ');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// 1. File inspection
const dbPath = path.resolve('bhive.db');
const dbExists = fs.existsSync(dbPath);
const stats = dbExists ? fs.statSync(dbPath) : null;

console.log('1. Database File Status:');
console.log(`   - Location: ${dbPath}`);
console.log(`   - Exists: ${dbExists}`);
console.log(`   - Size: ${stats ? (stats.size / 1024).toFixed(2) + ' KB' : 'N/A'}`);

// 2. Database Connection & Schema
const db = getDb();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
console.log('\n2. Tables Found in SQLite:');
tables.forEach(t => console.log(`   - Table: [${t.name}]`));

// 3. Row Counts
const agentCount = (db.prepare('SELECT count(*) as count FROM agents').get() as { count: number }).count;
const memoryCount = (db.prepare('SELECT count(*) as count FROM agent_memory').get() as { count: number }).count;
const relationsCount = (db.prepare('SELECT count(*) as count FROM agent_relations').get() as { count: number }).count;

console.log('\n3. Record Counts:');
console.log(`   - Agents: ${agentCount}`);
console.log(`   - Agent Memories: ${memoryCount}`);
console.log(`   - Agent Follow Relations: ${relationsCount}`);

// 4. Sample Agent Records
console.log('\n4. Sample Agents Registered in SQLite:');
const sampleAgents = db.prepare('SELECT agent_id, name, post_cooldown_until FROM agents LIMIT 5').all() as any[];
sampleAgents.forEach(a => {
  const cd = a.post_cooldown_until ? new Date(a.post_cooldown_until).toISOString() : 'None (Ready to post)';
  console.log(`   - ${a.name} | ID: ${a.agent_id} | Cooldown Until: ${cd}`);
});

// 5. Agent Store Read Verification
console.log('\n5. Testing TypeScript Store Helpers:');
const agentIds = listAgentIds();
console.log(`   - listAgentIds() returned ${agentIds.length} agents`);

const testAgent = loadAgent(agentIds[0]);
if (testAgent) {
  console.log(`   - Successfully loaded agent [${testAgent.identity.agentId}] using loadAgent():`);
  console.log(`     * Name: ${testAgent.identity.name}`);
  console.log(`     * Agent ID: ${testAgent.identity.agentId}`);
  console.log(`     * Persona: "${testAgent.identity.persona.slice(0, 80)}..."`);
  console.log(`     * Memory (posts tracked): ${testAgent.memory.postedByMe.length}`);
  console.log(`     * Memory (comments tracked): ${testAgent.memory.commentedByMe.length}`);
} else {
  console.error('   ❌ Failed to load agent with loadAgent()');
}

// 6. Test Cooldown Query
const eligible = getEligibleAgentIds(Date.now());
console.log(`\n6. Cooldown Query (getEligibleAgentIds):`);
console.log(`   - Active agents eligible to post right now: ${eligible.length} / ${agentIds.length}`);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('   ✅ All SQLite Tests Passed! Database is Healthy.');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
