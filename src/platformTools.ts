// =============================================================================
// src/platformTools.ts — Pi defineTool wrappers, one per platform API action.
//
// Call buildPlatformTools(apiKey) to get an array of ToolDefinitions where
// each tool's execute() closes over the agent's apiKey — the LLM never sees it.
// =============================================================================

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  getFeed,
  getPostDetail,
  getPostComments,
  createPost,
  createComment,
  vote,
  getMyNotifications,
  ackNotification,
} from "./platformClient.js";

export function buildPlatformTools(apiKey: string) {
  // -------------------------------------------------------------------------
  // get_feed
  // -------------------------------------------------------------------------
  const getFeedTool = defineTool({
    name: "get_feed",
    label: "Get Feed",
    description:
      "Fetches the current platform feed — a list of recent posts. Use this to decide what to engage with.",
    parameters: Type.Object({}),
    execute: async (_toolCallId, _params) => {
      const feed = await getFeed(apiKey);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(feed, null, 2) }],
        details: {},
      };
    },
  });

  // -------------------------------------------------------------------------
  // get_post_detail
  // -------------------------------------------------------------------------
  const getPostDetailTool = defineTool({
    name: "get_post_detail",
    label: "Get Post Detail",
    description: "Fetches full detail for a specific post by its ID.",
    parameters: Type.Object({
      postId: Type.String({ description: "The post ID to fetch." }),
    }),
    execute: async (_toolCallId, params) => {
      const post = await getPostDetail(apiKey, params.postId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(post, null, 2) }],
        details: {},
      };
    },
  });

  // -------------------------------------------------------------------------
  // get_post_comments
  // -------------------------------------------------------------------------
  const getPostCommentsTool = defineTool({
    name: "get_post_comments",
    label: "Get Post Comments",
    description: "Fetches all comments for a specific post.",
    parameters: Type.Object({
      postId: Type.String({ description: "The post ID whose comments to fetch." }),
    }),
    execute: async (_toolCallId, params) => {
      const comments = await getPostComments(apiKey, params.postId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(comments, null, 2) }],
        details: {},
      };
    },
  });

  // -------------------------------------------------------------------------
  // create_post
  // -------------------------------------------------------------------------
  const createPostTool = defineTool({
    name: "create_post",
    label: "Create Post",
    description:
      "Creates a new post on the platform. Use your persona's voice. Only call this if you have something interesting to say.",
    parameters: Type.Object({
      title: Type.String({ description: "Post title (concise, engaging)." }),
      content: Type.String({ description: "Post body content." }),
      submolt: Type.Optional(
        Type.String({ description: "Optional submolt (sub-community) to post in." })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const result = await createPost(apiKey, params.title, params.content, params.submolt);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: {},
      };
    },
  });

  // -------------------------------------------------------------------------
  // create_comment
  // -------------------------------------------------------------------------
  const createCommentTool = defineTool({
    name: "create_comment",
    label: "Create Comment",
    description: "Adds a comment to a post. Can optionally reply to a specific parent comment.",
    parameters: Type.Object({
      postId: Type.String({ description: "The post to comment on." }),
      content: Type.String({ description: "Comment body text." }),
      parentCommentId: Type.Optional(
        Type.String({ description: "Parent comment ID if replying to an existing comment." })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const result = await createComment(
        apiKey,
        params.postId,
        params.content,
        params.parentCommentId
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: {},
      };
    },
  });

  // -------------------------------------------------------------------------
  // vote
  // -------------------------------------------------------------------------
  const voteTool = defineTool({
    name: "vote",
    label: "Vote",
    description: "Upvote or downvote a post. Use 'up', 'down', or 'none' to remove vote.",
    parameters: Type.Object({
      postId: Type.String({ description: "The post ID to vote on." }),
      direction: Type.Union(
        [Type.Literal("up"), Type.Literal("down"), Type.Literal("none")],
        { description: "Vote direction." }
      ),
    }),
    execute: async (_toolCallId, params) => {
      await vote(apiKey, params.postId, params.direction as "up" | "down" | "none");
      return {
        content: [{ type: "text" as const, text: `Voted '${params.direction}' on post ${params.postId}.` }],
        details: {},
      };
    },
  });

  // -------------------------------------------------------------------------
  // get_my_notifications
  // -------------------------------------------------------------------------
  const getMyNotificationsTool = defineTool({
    name: "get_my_notifications",
    label: "Get My Notifications",
    description: "Fetches your unread notifications (replies, mentions, votes, etc.).",
    parameters: Type.Object({}),
    execute: async (_toolCallId, _params) => {
      const notifications = await getMyNotifications(apiKey);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(notifications, null, 2) }],
        details: {},
      };
    },
  });

  // -------------------------------------------------------------------------
  // ack_notification
  // -------------------------------------------------------------------------
  const ackNotificationTool = defineTool({
    name: "ack_notification",
    label: "Acknowledge Notification",
    description: "Marks a notification as read/acknowledged.",
    parameters: Type.Object({
      notificationId: Type.String({ description: "The notification ID to acknowledge." }),
    }),
    execute: async (_toolCallId, params) => {
      await ackNotification(apiKey, params.notificationId);
      return {
        content: [{ type: "text" as const, text: `Notification ${params.notificationId} acknowledged.` }],
        details: {},
      };
    },
  });

  return [
    getFeedTool,
    getPostDetailTool,
    getPostCommentsTool,
    createPostTool,
    createCommentTool,
    voteTool,
    getMyNotificationsTool,
    ackNotificationTool,
  ];
}

/** The tool names for use in createAgentSession's `tools` array */
export const PLATFORM_TOOL_NAMES = [
  "get_feed",
  "get_post_detail",
  "get_post_comments",
  "create_post",
  "create_comment",
  "vote",
  "get_my_notifications",
  "ack_notification",
] as const;
