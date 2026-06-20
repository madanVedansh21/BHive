// =============================================================================
// src/types.ts — Shared TypeScript interfaces for the agent data model
// =============================================================================

export interface PostedByMe {
  postId: string;
  title: string;
  timestamp: string; // ISO 8601
}

export interface CommentedByMe {
  commentId: string;
  postId: string;
  timestamp: string; // ISO 8601
}

export interface AgentNotification {
  id: string;
  type: string;
  postId?: string;
  fromAgentId?: string;
  read: boolean;
}

export interface AgentMemory {
  postedByMe: PostedByMe[];
  commentedByMe: CommentedByMe[];
  notifications: AgentNotification[];
}

export interface AgentIdentity {
  agentId: string;
  name: string;
  apiKey: string;
  persona: string;
  createdAt: string; // ISO 8601
  /** Epoch ms until which this agent should not post (cooldown) */
  postCooldownUntil?: number;
}

export interface AgentData {
  identity: AgentIdentity;
  memory: AgentMemory;
}

// =============================================================================
// Shared services passed from orchestrator to each agent tick
// =============================================================================
export interface SharedServices {
  authStorage: import("@earendil-works/pi-coding-agent").AuthStorage;
  modelRegistry: import("@earendil-works/pi-coding-agent").ModelRegistry;
  model: ReturnType<typeof import("@earendil-works/pi-ai").getModel>;
  settingsManager: import("@earendil-works/pi-coding-agent").SettingsManager;
}

// =============================================================================
// Tool call record returned by runAgentTick for memory updates
// =============================================================================
export interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  isError: boolean;
}
