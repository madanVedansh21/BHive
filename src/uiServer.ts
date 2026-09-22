// =============================================================================
// src/uiServer.ts — BHive UI daemon.
//
// Starts:
//   1. Express HTTP server (serves static React build + REST API)
//   2. WebSocket server (real-time event stream + command handling)
//   3. BHive orchestrator in the same process
//
// Usage:
//   npm run ui
//   npm run ui -- --port 4242
// =============================================================================

import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { bus } from "./eventBus";
import { BHiveEvent, UICommand } from "./uiTypes";
import { listAgentIds, loadAgent } from "./agentStore";
import { getState } from "./improve/promoter";
import { rollbackStrategy } from "./improve/promoter";
import { runImprovementCycle } from "./improve/improveSession";
import { executeCommand, killCommand, getActiveCommands } from "./commandRunner";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.UI_PORT ?? "4242", 10);
const UI_STATIC_DIR = path.resolve(process.cwd(), "ui", "dist");
const REPLAY_BUFFER_SIZE = 200;

// ---------------------------------------------------------------------------
// Replay buffer — circular array of last N events
// ---------------------------------------------------------------------------

const replayBuffer: BHiveEvent[] = [];

function pushToReplay(event: BHiveEvent): void {
  replayBuffer.push(event);
  if (replayBuffer.length > REPLAY_BUFFER_SIZE) {
    replayBuffer.shift();
  }
}

// ---------------------------------------------------------------------------
// Orchestrator state (pause/resume)
// ---------------------------------------------------------------------------

let orchestratorPaused = false;

export function isOrchestratorPaused(): boolean {
  return orchestratorPaused;
}

// ---------------------------------------------------------------------------
// WebSocket broadcast
// ---------------------------------------------------------------------------

const clients = new Set<WebSocket>();

function broadcast(event: BHiveEvent): void {
  const msg = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// ---------------------------------------------------------------------------
// REST API handlers
// ---------------------------------------------------------------------------

function buildAgentsSnapshot() {
  const ids = listAgentIds();
  return ids.map((id) => {
    try {
      const agent = loadAgent(id);
      return {
        agentId: agent.identity.agentId,
        name: agent.identity.name,
        persona: agent.identity.persona.slice(0, 120) + "...",
        postCooldownUntil: agent.identity.postCooldownUntil ?? null,
        memory: {
          postCount: agent.memory.postedByMe.length,
          commentCount: agent.memory.commentedByMe.length,
          notificationCount: agent.memory.notifications.length,
          unreadCount: agent.memory.notifications.filter((n) => !n.read).length,
        },
      };
    } catch {
      return { agentId: id, error: "failed to load" };
    }
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function startUIServer(): Promise<void> {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Serve static React build
  if (fs.existsSync(UI_STATIC_DIR)) {
    app.use(express.static(UI_STATIC_DIR));
  }

  // REST: agents snapshot
  app.get("/api/agents", (_req, res) => {
    res.json(buildAgentsSnapshot());
  });

  // REST: improvement state
  app.get("/api/improvement/:target", (req, res) => {
    try {
      const state = getState(req.params.target as "memory");
      res.json(state);
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  // REST: improvement history
  app.get("/api/improvement/:target/history", (req, res) => {
    const histPath = path.resolve(process.cwd(), "improvement", "history.jsonl");
    if (!fs.existsSync(histPath)) return res.json([]);
    const lines = fs.readFileSync(histPath, "utf-8").trim().split("\n").filter(Boolean);
    const entries = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    res.json(entries.reverse()); // newest first
  });

  // REST: active commands
  app.get("/api/commands/active", (_req, res) => {
    res.json(getActiveCommands());
  });

  // SPA fallback
  app.use((_req, res) => {
    const indexPath = path.join(UI_STATIC_DIR, "index.html");
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.send(`<html><body style="background:#09090b;color:#fafafa;font-family:monospace;padding:2rem">
        <h2>🐝 BHive UI</h2>
        <p>UI not built yet. Run <code>cd ui && npm install && npm run build</code></p>
        <p>WebSocket is live on this port. REST API is ready.</p>
      </body></html>`);
    }
  });

  const server = http.createServer(app);

  // WebSocket server
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    clients.add(ws);
    console.log(`[UI] Client connected (${clients.size} total)`);

    // Replay buffer on connect
    for (const event of replayBuffer) {
      ws.send(JSON.stringify(event));
    }

    ws.on("message", async (raw) => {
      let cmd: UICommand;
      try {
        cmd = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (cmd.type) {
        case "orchestrator:pause":
          orchestratorPaused = true;
          bus.publish("orchestrator:paused", {});
          break;
        case "orchestrator:resume":
          orchestratorPaused = false;
          bus.publish("orchestrator:resumed", {});
          break;
        case "improvement:trigger":
          runImprovementCycle().catch((e) =>
            console.error("[UI] Improvement cycle error:", e)
          );
          break;
        case "improvement:rollback":
          try {
            const msg = rollbackStrategy(cmd.target as "memory");
            console.log("[UI] Rollback:", msg);
          } catch (e) {
            console.error("[UI] Rollback error:", e);
          }
          break;
        case "command:exec":
          try {
            executeCommand({
              commandId: cmd.commandId,
              cmd: cmd.cmd,
              args: cmd.args,
              raw: cmd.raw,
            });
          } catch (err: unknown) {
            console.error("[UI] Command execution error:", err);
          }
          break;
        case "command:kill":
          killCommand(cmd.commandId);
          break;
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      console.log(`[UI] Client disconnected (${clients.size} total)`);
    });
  });

  // Subscribe to bus → broadcast to all WS clients + push to replay
  bus.onEvent((event) => {
    pushToReplay(event);
    broadcast(event);
  });

  server.listen(PORT, () => {
    console.log(`[UI] BHive dashboard running at http://localhost:${PORT}`);
    console.log(`[UI] WebSocket server ready`);
  });
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  // Dynamically import orchestrator to avoid circular deps at module level
  startUIServer().then(() => {
    const { startOrchestrator } = require("./orchestrator");
    startOrchestrator().catch((err: Error) => {
      console.error("[Orchestrator] Fatal:", err);
      process.exit(1);
    });
  }).catch((err) => {
    console.error("[UI] Fatal:", err);
    process.exit(1);
  });
}
