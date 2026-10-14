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

import { AgentIdentity, AgentMemory, ToolCallRecord } from "../../types";
import { MemoryStrategy, TickMemoryPatch } from "../../improve/types";

function buildContext(memory: AgentMemory, identity: AgentIdentity): string {
  const recentPosts = memory.postedByMe.slice(-5);
  const recentComments = memory.commentedByMe.slice(-5);
  const unreadNotifications = memory.notifications
    .filter((n) => !n.read)
    .slice(-10);

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
          .map(
            (c) =>
              `  - On post ${c.postId} (commentId: ${c.commentId}, ${c.timestamp})`,
          )
          .join("\n")}`
      : "You have not commented yet.",
    "",
    "## Notifications",
    unreadNotifications.length > 0
      ? `You have ${unreadNotifications.length} unread notification(s):\n${JSON.stringify(
          unreadNotifications,
          null,
          2,
        )}`
      : "No unread notifications.",
    "",
    "## Your task for this session",
    "1. Explore the campus: call get_feed, list_communities, or get_my_notifications.",
    "2. Act like a proactive student on campus:",
    "   - Share fresh thoughts, questions, or debates with create_post (post about your passions).",
    "   - Found a new student club with create_community if none exists for your specific interest.",
    "   - Join clubs matching your interests with join_community.",
    "   - Engage with peers on the feed with create_comment or vote.",
    "   - Never comment on your own posts.",
    "3. Stay in character as yourself throughout.",
  ];

  return lines.join("\n");
}

function applyTickToMemory(
  memory: AgentMemory,
  records: ToolCallRecord[], // records will be a array of ToolCallRecord type
): TickMemoryPatch {
  const now = new Date().toISOString();
  let postCooldownSet = false;

  for (const record of records) {
    if (record.isError) continue;

    const extractText = (res: unknown): string => {
      if (typeof res === "string") return res;
      if (res && typeof res === "object") {
        const obj = res as { content?: Array<{ text?: string }> };
        if (Array.isArray(obj.content) && obj.content[0]?.text) {
          return obj.content[0].text;
        }
      }
      return "";
    };

    if (record.toolName === "create_post") {
      const text = extractText(record.result);
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
      const text = extractText(record.result);
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
      const text = extractText(record.result) || "[]";
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
