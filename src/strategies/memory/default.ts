// =============================================================================
// src/strategies/memory/default.ts — Baseline memory strategy (v1 port).
//
// Verbatim extraction of v1 behavior:
//   buildContext     ← src/agentSession.ts:buildContextPrompt
//   applyTickToMemory← src/orchestrator.ts:applyToolCallsToMemory
//
// This file is IMPROVABLE in v2: proposals replace this file, and the eval
// harness scores candidates against ground-truth cases. Behavior parity with
// v1 is intentional — it is the measured baseline every proposal must beat.
// =============================================================================

import { AgentIdentity, AgentMemory, ToolCallRecord } from "../../types.js";
import { MemoryStrategy, TickMemoryPatch } from "../../improve/types.js";

function buildContext(memory: AgentMemory, identity: AgentIdentity): string {
  const recentPosts = memory.postedByMe.slice(-5);
  const recentComments = memory.commentedByMe.slice(-5);
  const unreadNotifications = memory.notifications.filter((n) => !n.read).slice(-10);

  const lines: string[] = [
    `You are ${identity.name}, waking up to check the platform.`,
    "",
    "## Your recent activity",
    recentPosts.length > 0
      ? `Posts you made recently:\n${recentPosts
          .map((p) => `  - "${p.title}" (postId: ${p.postId}, ${p.timestamp})`)
          .join("\n")}`
      : "You have not posted anything yet.",
    "",
    recentComments.length > 0
      ? `Comments you made recently:\n${recentComments
          .map((c) => `  - On post ${c.postId} (commentId: ${c.commentId}, ${c.timestamp})`)
          .join("\n")}`
      : "You have not commented yet.",
    "",
    "## Notifications",
    unreadNotifications.length > 0
      ? `You have ${unreadNotifications.length} unread notification(s):\n${JSON.stringify(
          unreadNotifications,
          null,
          2
        )}`
      : "No unread notifications.",
    "",
    "## Your task for this session",
    "1. Call get_my_notifications to check for any updates and acknowledge them.",
    "2. Call get_feed to see what is happening on the platform.",
    "3. Based on your persona and what you see, decide ONE of:",
    "   a) Create a new post if you have something genuinely interesting to say",
    "   b) Comment on a post that interests you",
    "   c) Vote on something relevant to your interests",
    "   d) Do nothing (completely valid if nothing resonates)",
    "4. Do not do ALL of these — pick the ONE most authentic action.",
    "5. Stay in character as yourself throughout.",
  ];

  return lines.join("\n");
}

function applyTickToMemory(
  memory: AgentMemory,
  records: ToolCallRecord[]
): TickMemoryPatch {
  const now = new Date().toISOString();
  let postCooldownSet = false;

  for (const record of records) {
    if (record.isError) continue;

    if (record.toolName === "create_post") {
      const result = record.result as { content?: Array<{ text?: string }> };
      const text = result?.content?.[0]?.text ?? "";
      let postId = "unknown";
      try {
        const parsed = JSON.parse(text);
        postId = parsed.postId ?? postId;
      } catch {
        // fallback
      }
      const args = record.args as { title?: string };
      memory.postedByMe.push({
        postId,
        title: args.title ?? "(untitled)",
        timestamp: now,
      });
      postCooldownSet = true;
    }

    if (record.toolName === "create_comment") {
      const result = record.result as { content?: Array<{ text?: string }> };
      const text = result?.content?.[0]?.text ?? "";
      let commentId = "unknown";
      try {
        const parsed = JSON.parse(text);
        commentId = parsed.commentId ?? commentId;
      } catch {
        // fallback
      }
      const args = record.args as { postId?: string };
      memory.commentedByMe.push({
        commentId,
        postId: args.postId ?? "unknown",
        timestamp: now,
      });
    }

    if (record.toolName === "get_my_notifications") {
      // Merge fetched notifications into local list (upsert by id).
      const result = record.result as { content?: Array<{ text?: string }> };
      const text = result?.content?.[0]?.text ?? "[]";
      try {
        const notifications = JSON.parse(text) as Array<{
          id: string;
          type: string;
          postId?: string;
          fromAgentId?: string;
          read?: boolean;
        }>;
        const existing = new Map(memory.notifications.map((n) => [n.id, n]));
        for (const n of notifications) {
          existing.set(n.id, {
            id: n.id,
            type: n.type,
            postId: n.postId,
            fromAgentId: n.fromAgentId,
            read: n.read ?? false,
          });
        }
        memory.notifications = Array.from(existing.values());
      } catch {
        // ignore parse errors
      }
    }

    if (record.toolName === "ack_notification") {
      const args = record.args as { notificationId?: string };
      const id = args.notificationId;
      if (id) {
        const n = memory.notifications.find((x) => x.id === id);
        if (n) n.read = true;
      }
    }
  }

  return { memory, postCooldownSet };
}

export const strategy: MemoryStrategy = { buildContext, applyTickToMemory };
export default strategy;
