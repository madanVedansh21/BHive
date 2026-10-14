// =============================================================================
// src/agentSession.ts — Per-agent tick runner with direct HTTP ReAct execution
//
// Why: Local models (Qwen2.5, Llama, etc.) loaded via Unsloth/llama.cpp often
// lack native function-calling schemas in their GGUF templates. This module
// implements a rock-solid, text-based ReAct loop that works with ANY
// OpenAI-compatible endpoint (Unsloth, Ollama, OpenRouter, OpenAI, Groq).
// =============================================================================

import "./env";
import { AgentData, SharedServices, ToolCallRecord } from "./types";
import {
  getFeed,
  getPostDetail,
  getPostComments,
  createPost,
  createComment,
  vote,
  getMyNotifications,
  ackNotification,
  listCommunities,
  createCommunity,
  joinCommunity,
} from "./platformClient";
import { loadStrategy } from "./improve/registry";
import { bus } from "./eventBus";
import { saveAgentReasoningTrace, AgentTickTrace } from "./logger";

const MAX_STEPS = 6;

// ---------------------------------------------------------------------------
// Tool registry — maps tool name to executor function
// ---------------------------------------------------------------------------

type ToolFn = (args: Record<string, string>) => Promise<string>;

function buildToolRegistry(apiKey: string, agentId: string): Record<string, ToolFn> {
  return {
    get_feed: async () => {
      const feed = await getFeed(apiKey);
      // Filter out posts authored by this agent — agents must not engage with their own posts
      const filtered = feed.filter((p) => p.authorId !== agentId);
      return JSON.stringify(filtered, null, 2);
    },
    get_post_detail: async (args) => {
      const post = await getPostDetail(apiKey, args.postId);
      return JSON.stringify(post, null, 2);
    },
    get_post_comments: async (args) => {
      const comments = await getPostComments(apiKey, args.postId);
      return JSON.stringify(comments, null, 2);
    },
    create_post: async (args) => {
      const result = await createPost(apiKey, args.title, args.content, args.subcom);
      return JSON.stringify(result, null, 2);
    },
    create_comment: async (args) => {
      // Guard: never allow an agent to comment on its own post
      const post = await getPostDetail(apiKey, args.postId);
      if (post.authorId === agentId) {
        return JSON.stringify({
          error: "SELF_COMMENT_BLOCKED",
          message: "You cannot comment on your own post. Find another post to engage with.",
        });
      }
      const result = await createComment(apiKey, args.postId, args.content, args.parentCommentId);
      return JSON.stringify(result, null, 2);
    },
    vote: async (args) => {
      await vote(apiKey, args.postId, (args.direction as "up" | "down" | "none") || "up");
      return `Voted '${args.direction || "up"}' on post ${args.postId}.`;
    },
    get_my_notifications: async () => {
      const notifications = await getMyNotifications(apiKey);
      return JSON.stringify(notifications, null, 2);
    },
    ack_notification: async (args) => {
      await ackNotification(apiKey, args.notificationId);
      return `Notification ${args.notificationId} acknowledged.`;
    },
    list_communities: async () => {
      const comms = await listCommunities(apiKey);
      return JSON.stringify(comms, null, 2);
    },
    create_community: async (args) => {
      const result = await createCommunity(apiKey, args.name, args.description);
      return JSON.stringify(result, null, 2);
    },
    join_community: async (args) => {
      const result = await joinCommunity(apiKey, args.communityId);
      return JSON.stringify(result, null, 2);
    },
  };
}

// ---------------------------------------------------------------------------
// System instructions for ReAct formatting
// ---------------------------------------------------------------------------

const TOOL_SYSTEM_PROMPT = `
You are an autonomous student on a campus social network (ICB).
You interact with the platform using tools.

To call a tool, you MUST use this exact format:
ACTION: <tool_name>
ACTION_INPUT: <json_object>

Available tools:
- get_feed: {} (Fetch the recent global platform posts)
- list_communities: {} (List all campus communities and interest clubs)
- create_community: {"name": "coding_club", "description": "Club description"} (Create a new community)
- join_community: {"communityId": "community_name_or_id"} (Join a community)
- create_post: {"title": "Post Title", "content": "Body text", "subcom": "optional_community_name"} (Share a new post)
- create_comment: {"postId": "post_id_here", "content": "Your comment"} (Comment on a post)
- get_post_comments: {"postId": "post_id_here"} (Read existing comments on a post)
- vote: {"postId": "post_id_here", "direction": "up"} (Vote "up" or "down" on a post)
- get_my_notifications: {} (Check unread notifications)
- ack_notification: {"notificationId": "id"} (Mark a notification as read)

Rules:
1. Always start by checking get_my_notifications.
2. PRIORITY RULE: If you have received any notifications (someone commented on your post or replied to you), your FIRST priority is to reply back! Call create_comment on that postId to respond to them, then call ack_notification to clear it.
3. Only if you have NO unread notifications to reply to, proceed to check get_feed or list_communities and perform an authentic action (comment on an interesting post, join or create a community, vote, or create a post).
4. If no communities exist that fit your persona, feel free to call create_community!
5. Write in your persona's unique voice.
6. NEVER use em dashes, en dashes, or double hyphens. Use commas, colons, or parentheses.
7. When done with your action, output:
FINISH: <short summary of what you did>
8. CRITICAL: NEVER comment on a post that you authored. The feed already excludes your own posts. If create_comment returns a SELF_COMMENT_BLOCKED error, immediately pick a different post to engage with and do NOT retry on the same post.
`.trim();

// ---------------------------------------------------------------------------
// Model Provider Resolver
// ---------------------------------------------------------------------------

interface EndpointConfig {
  url: string;
  apiKey: string;
  model: string;
}

function getLLMEndpoint(): EndpointConfig {
  const provider = (process.env.MODEL_PROVIDER || "unsloth").toLowerCase();
  const model = process.env.MODEL_ID || "qwen2.5-coder";

  if (provider === "openrouter") {
    return {
      url: "https://openrouter.ai/api/v1/chat/completions",
      apiKey: process.env.OPENROUTER_API_KEY || process.env.MY_KEY || "",
      model,
    };
  }

  if (provider === "openai") {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      apiKey: process.env.OPENAI_API_KEY || process.env.MY_KEY || "",
      model,
    };
  }

  // Default to Unsloth / Localhost OpenAI-compatible endpoint
  const baseUrl = process.env.UNSLOTH_BASE_URL || "http://127.0.0.1:50297/v1";
  return {
    url: `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
    apiKey: process.env.UNSLOTH_API_KEY || process.env.MY_KEY || "local",
    model,
  };
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function callLLM(messages: ChatMessage[]): Promise<string> {
  const endpoint = getLLMEndpoint();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify({
        model: endpoint.model,
        messages,
        max_tokens: 600,
        temperature: 0.75,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "(no body)");
      throw new Error(`LLM HTTP [${response.status}] ${response.statusText}: ${errBody}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Output Parser (handles markdown, code fences, single/multiline JSON)
// ---------------------------------------------------------------------------

interface ParsedAction {
  type: "tool_call";
  toolName: string;
  args: Record<string, string>;
}
interface ParsedFinish {
  type: "finish";
  summary: string;
}
type ParsedStep = ParsedAction | ParsedFinish | null;

function parseModelOutput(text: string): ParsedStep {
  const finishMatch = text.match(/FINISH:\s*([\s\S]*)/i);
  const actionMatch = text.match(/(?:ACTION|Tool|Function):\s*([a-zA-Z0-9_]+)/i);

  // If finish comes before action or action is absent
  if (finishMatch && (!actionMatch || text.indexOf(finishMatch[0]) < text.indexOf(actionMatch[0]))) {
    return { type: "finish", summary: finishMatch[1].trim() };
  }

  if (actionMatch) {
    const toolName = actionMatch[1].trim().toLowerCase();
    let args: Record<string, string> = {};

    // Try finding JSON block inside markdown ```json ... ``` or raw {...}
    const inputMatch =
      text.match(/(?:ACTION_INPUT|Args|Parameters):\s*(?:```(?:json)?\s*)?(\{[\s\S]*?\})(?:\s*```)?/i) ||
      text.match(/(?:```(?:json)?\s*)(\{[\s\S]*?\})(?:\s*```)/i) ||
      text.match(/(\{[\s\S]*?\})/);

    if (inputMatch) {
      try {
        args = JSON.parse(inputMatch[1]);
      } catch {
        // Fallback: regex extraction of simple key-value pairs
        const kvPairs = inputMatch[1].matchAll(/"([a-zA-Z0-9_]+)"\s*:\s*"([^"]*)"/g);
        for (const [, k, v] of kvPairs) args[k] = v;
      }
    }

    return { type: "tool_call", toolName, args };
  }

  if (finishMatch) {
    return { type: "finish", summary: finishMatch[1].trim() };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main Tick Function
// ---------------------------------------------------------------------------

export async function runAgentTick(
  agentData: AgentData,
  _services: SharedServices,
  tickIndex: number = 0
): Promise<ToolCallRecord[]> {
  const { identity } = agentData;
  console.log(`[${identity.name}] Starting tick…`);

  bus.publish("agent:wakeup", {
    agentId: identity.agentId,
    name: identity.name,
    tickIndex,
  });

  const memoryStrategy = loadStrategy("memory");
  const toolRegistry = buildToolRegistry(identity.apiKey, identity.agentId);
  const contextPrompt = memoryStrategy.buildContext(agentData.memory, identity);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${identity.persona}\n\n${TOOL_SYSTEM_PROMPT}`,
    },
    {
      role: "user",
      content: contextPrompt,
    },
  ];

  const startTime = Date.now();
  const toolCallRecords: ToolCallRecord[] = [];
  const traceSteps: AgentTickTrace["steps"] = [];
  let finishSummary: string | undefined;
  let steps = 0;

  while (steps < MAX_STEPS) {
    steps++;

    let modelText: string;
    try {
      modelText = await callLLM(messages);
    } catch (err) {
      console.error(`  [${identity.name}] LLM call error:`, err);
      break;
    }

    if (!modelText.trim()) {
      console.warn(`  [${identity.name}] Model returned empty string, finishing tick.`);
      break;
    }

    bus.publish("agent:thinking", {
      agentId: identity.agentId,
      name: identity.name,
      text: modelText,
      tickIndex,
    });

    messages.push({ role: "assistant", content: modelText });

    const parsed = parseModelOutput(modelText);

    if (!parsed) {
      traceSteps.push({
        step: steps,
        thinking: modelText,
      });
      console.log(`  [${identity.name}] No tool action detected. Session concluded.`);
      break;
    }

    if (parsed.type === "finish") {
      finishSummary = parsed.summary;
      traceSteps.push({
        step: steps,
        thinking: modelText,
      });
      console.log(`  [${identity.name}] Finished: ${parsed.summary.slice(0, 80)}`);
      break;
    }

    const { toolName, args } = parsed;
    const toolFn = toolRegistry[toolName];

    if (!toolFn) {
      const errMsg = `Unknown tool '${toolName}'.`;
      console.error(`  [${identity.name}] ✗ ${errMsg}`);
      traceSteps.push({
        step: steps,
        thinking: modelText,
        toolCall: { toolName, args },
        toolResult: errMsg,
        isError: true,
      });
      messages.push({
        role: "user",
        content: `TOOL_ERROR: ${errMsg} Available tools: ${Object.keys(toolRegistry).join(", ")}`,
      });
      toolCallRecords.push({
        toolName,
        args,
        result: { content: [{ type: "text", text: errMsg }] },
        isError: true,
      });
      continue;
    }

    let toolResult: string;
    let isError = false;
    try {
      toolResult = await toolFn(args);
      console.log(`  [${identity.name}] ✓ tool: ${toolName}`);
    } catch (err: unknown) {
      toolResult = err instanceof Error ? err.message : String(err);
      isError = true;
      console.error(`  [${identity.name}] ✗ tool error [${toolName}]: ${toolResult}`);
    }

    traceSteps.push({
      step: steps,
      thinking: modelText,
      toolCall: { toolName, args },
      toolResult,
      isError,
    });

    toolCallRecords.push({
      toolName,
      args,
      result: { content: [{ type: "text", text: toolResult }] },
      isError,
    });

    bus.publish("agent:tool_call", {
      agentId: identity.agentId,
      name: identity.name,
      toolName,
      args,
    });

    bus.publish("agent:tool_result", {
      agentId: identity.agentId,
      name: identity.name,
      toolName,
      isError,
      result: toolResult,
    });

    messages.push({
      role: "user",
      content: `TOOL_RESULT (${toolName}):\n${toolResult}\n\nWhat is your next action, or output FINISH if done?`,
    });
  }

  // Persist the full reasoning trace as a JSON file
  saveAgentReasoningTrace({
    id: `trace_${identity.agentId}_tick${tickIndex}_${Date.now()}`,
    timestamp: new Date().toISOString(),
    tickIndex,
    agentId: identity.agentId,
    name: identity.name,
    contextPrompt,
    steps: traceSteps,
    finishSummary,
    durationMs: Date.now() - startTime,
    toolCallCount: toolCallRecords.length,
  });

  bus.publish("agent:session_end", {
    agentId: identity.agentId,
    name: identity.name,
    tickIndex,
    toolCallCount: toolCallRecords.length,
  });

  console.log(`  [${identity.name}] Session ended.`);
  return toolCallRecords;
}
