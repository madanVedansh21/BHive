// =============================================================================
// src/platformClient.ts — Thin fetch-based REST client for the platform API
// =============================================================================

const BASE_URL = process.env.PLATFORM_BASE_URL ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(
  path: string,
  apiKey: string | null,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "(no body)");
    throw new Error(
      `Platform API error [${response.status}] ${response.statusText} — ${path}: ${body}`
    );
  }

  // 204 No Content
  if (response.status === 204) return undefined as T;

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Auth (no apiKey needed)
// ---------------------------------------------------------------------------

export interface RegisterResult {
  agentId: string;
  apiKey: string;
}

export async function registerAgent(desiredName: string): Promise<RegisterResult> {
  return apiFetch<RegisterResult>("/auth/register", null, {
    method: "POST",
    body: JSON.stringify({ desiredName }),
  });
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

export interface FeedPost {
  id: string;
  title: string;
  content: string;
  submolt?: string;
  authorId: string;
  createdAt: string;
  voteScore?: number;
}

export async function getFeed(apiKey: string): Promise<FeedPost[]> {
  return apiFetch<FeedPost[]>("/feed", apiKey);
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export interface PostDetail extends FeedPost {
  commentCount?: number;
}

export async function getPostDetail(apiKey: string, postId: string): Promise<PostDetail> {
  return apiFetch<PostDetail>(`/posts/${postId}`, apiKey);
}

export interface Comment {
  id: string;
  postId: string;
  content: string;
  authorId: string;
  parentCommentId?: string;
  createdAt: string;
}

export async function getPostComments(apiKey: string, postId: string): Promise<Comment[]> {
  return apiFetch<Comment[]>(`/posts/${postId}/comments`, apiKey);
}

export interface CreatePostResult {
  postId: string;
}

export async function createPost(
  apiKey: string,
  title: string,
  content: string,
  submolt?: string
): Promise<CreatePostResult> {
  return apiFetch<CreatePostResult>("/posts", apiKey, {
    method: "POST",
    body: JSON.stringify({ title, content, submolt }),
  });
}

export interface CreateCommentResult {
  commentId: string;
}

export async function createComment(
  apiKey: string,
  postId: string,
  content: string,
  parentCommentId?: string
): Promise<CreateCommentResult> {
  return apiFetch<CreateCommentResult>(`/posts/${postId}/comments`, apiKey, {
    method: "POST",
    body: JSON.stringify({ content, parentCommentId }),
  });
}

export type VoteDirection = "up" | "down" | "none";

export async function vote(
  apiKey: string,
  postId: string,
  direction: VoteDirection
): Promise<void> {
  return apiFetch<void>(`/posts/${postId}/vote`, apiKey, {
    method: "POST",
    body: JSON.stringify({ direction }),
  });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface PlatformNotification {
  id: string;
  type: string;
  postId?: string;
  fromAgentId?: string;
  read: boolean;
  createdAt: string;
}

export async function getMyNotifications(apiKey: string): Promise<PlatformNotification[]> {
  return apiFetch<PlatformNotification[]>("/notifications", apiKey);
}

export async function ackNotification(apiKey: string, notificationId: string): Promise<void> {
  return apiFetch<void>(`/notifications/${notificationId}/ack`, apiKey, {
    method: "POST",
  });
}
