// =============================================================================
// src/improveTools.ts — Tools provided exclusively to Improvement Sessions.
//
// These tools allow an agent to introspect its own logic and propose improvements:
//   1. list_improvable_files — lists targets, active version, baseline score
//   2. read_improvable_file  — safely reads the source of an allowlisted strategy
//   3. get_eval_report       — runs deterministic eval suite and returns scores
//   4. propose_change        — tests candidate code in sandbox and promotes if better
//
// Security boundary:
//   • Only files in src/strategies/ within ALLOWED_TARGETS can ever be read or modified
//   • No arbitrary filesystem access, no shell execution, no platform write tools
// =============================================================================

import { bus } from "./eventBus";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "fs";
import * as path from "path";
import { ALLOWED_TARGETS, isAllowedTarget, ImprovableTarget } from "./improve/registry";
import { getState, promoteProposal } from "./improve/promoter";
import { runEval } from "./improve/evalRunner";
import { runInSandbox } from "./improve/sandbox";

const STRATEGIES_ROOT = path.resolve(__dirname, "strategies");
const DATASET_PATH = path.resolve(__dirname, "improve", "dataset", "memory.v0.jsonl");

export const IMPROVE_TOOL_NAMES = [
  "list_improvable_files",
  "read_improvable_file",
  "get_eval_report",
  "propose_change",
] as const;

export function buildImproveTools() {
  // -------------------------------------------------------------------------
  // 1. list_improvable_files
  // -------------------------------------------------------------------------
  const listImprovableFilesTool = defineTool({
    name: "list_improvable_files",
    label: "List Improvable Files",
    description:
      "Lists all strategy modules available for self-improvement, along with their current version and baseline eval score.",
    parameters: Type.Object({}),
    execute: async (_toolCallId, _params) => {
      const targetsInfo = ALLOWED_TARGETS.map((target) => {
        const state = getState(target);
        return {
          target,
          filePath: `src/strategies/${target}/default.ts`,
          version: state.version,
          baselineScore: state.baseline,
          samples: state.samples,
          lastUpdated: state.updatedAt,
          description:
            target === "memory"
              ? "Controls how agent memory is updated after each tick and how memory is formatted into context prompts."
              : "Strategy module",
        };
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(targetsInfo, null, 2),
          },
        ],
        details: {},
      };
    },
  });

  // -------------------------------------------------------------------------
  // 2. read_improvable_file
  // -------------------------------------------------------------------------
  const readImprovableFileTool = defineTool({
    name: "read_improvable_file",
    label: "Read Improvable File",
    description:
      "Reads the current live source code of an improvable strategy module (e.g. 'memory').",
    parameters: Type.Object({
      target: Type.String({
        description: `Name of the improvable target (allowed: ${ALLOWED_TARGETS.join(", ")})`,
      }),
    }),
    execute: async (_toolCallId, params) => {
      if (!isAllowedTarget(params.target)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Target "${params.target}" is not improvable. Allowed targets: ${ALLOWED_TARGETS.join(", ")}`,
            },
          ],
          details: {},
        };
      }

      const filePath = path.join(STRATEGIES_ROOT, params.target, "default.ts");
      if (!fs.existsSync(filePath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: File not found at ${filePath}`,
            },
          ],
          details: {},
        };
      }

      const code = fs.readFileSync(filePath, "utf-8");
      return {
        content: [
          {
            type: "text" as const,
            text: code,
          },
        ],
        details: {},
      };
    },
  });

  // -------------------------------------------------------------------------
  // 3. get_eval_report
  // -------------------------------------------------------------------------
  const getEvalReportTool = defineTool({
    name: "get_eval_report",
    label: "Get Eval Report",
    description:
      "Runs the offline deterministic evaluation suite against the currently active strategy and returns the score and detailed test results.",
    parameters: Type.Object({
      target: Type.String({
        description: `Name of the target to evaluate (allowed: ${ALLOWED_TARGETS.join(", ")})`,
      }),
    }),
    execute: async (_toolCallId, params) => {
      if (!isAllowedTarget(params.target)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Target "${params.target}" is not allowed.`,
            },
          ],
          details: {},
        };
      }

      try {
        const evalResult = await runEval(DATASET_PATH);
        const state = getState(params.target as ImprovableTarget);

        const report = {
          target: params.target,
          currentVersion: state.version,
          score: `${(evalResult.score * 100).toFixed(1)}%`,
          rawScore: evalResult.score,
          passedCases: evalResult.passedCases,
          failedCases: evalResult.failedCases,
          totalCases: evalResult.totalCases,
          cases: evalResult.cases.map((c) => ({
            id: c.caseId,
            description: c.description,
            pass: c.pass,
            score: c.score,
            error: c.error,
          })),
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(report, null, 2),
            },
          ],
          details: {},
        };
      } catch (err: unknown) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error running evaluation: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: {},
        };
      }
    },
  });

  // -------------------------------------------------------------------------
  // 4. propose_change
  // -------------------------------------------------------------------------
  const proposeChangeTool = defineTool({
    name: "propose_change",
    label: "Propose Code Change",
    description:
      "Submits a proposed complete replacement for a strategy module. The proposed code will be compiled and evaluated in an isolated sandbox. If it passes validation and improves or matches the baseline score, it will be automatically promoted.",
    parameters: Type.Object({
      target: Type.String({
        description: `Target module to modify (allowed: ${ALLOWED_TARGETS.join(", ")})`,
      }),
      newContent: Type.String({
        description:
          "The complete, full new TypeScript code for default.ts. Must satisfy the MemoryStrategy interface.",
      }),
      rationale: Type.String({
        description:
          "Explanation of what behavioral hypothesis is being tested and why this change is expected to improve performance.",
      }),
    }),
    execute: async (_toolCallId, params) => {
      if (!isAllowedTarget(params.target)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Target "${params.target}" is not allowed.`,
            },
          ],
          details: {},
        };
      }

      const proposalId = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      bus.publish("improvement:proposal_submitted", {
        proposalId,
        target: params.target,
        rationale: params.rationale,
      });

      try {
        // 1. Run isolated sandbox evaluation
        const sandboxResult = await runInSandbox(
          params.target as ImprovableTarget,
          params.newContent,
          proposalId
        );

        bus.publish("improvement:sandbox_result", {
          proposalId,
          verdict: sandboxResult.verdict,
          score: sandboxResult.score,
          passedCases: sandboxResult.passedCases,
          totalCases: sandboxResult.totalCases,
          errorMessage: sandboxResult.errorMessage,
        });

        if (sandboxResult.verdict !== "ACCEPTED" && sandboxResult.score < 0.98) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    status: "REJECTED_BY_SANDBOX",
                    verdict: sandboxResult.verdict,
                    score: sandboxResult.score,
                    passedCases: sandboxResult.passedCases,
                    totalCases: sandboxResult.totalCases,
                    errorMessage: sandboxResult.errorMessage,
                    detail: sandboxResult.detail,
                    instruction:
                      "Analyze the error or failing test cases above, refine your hypothesis, and propose a corrected version.",
                  },
                  null,
                  2
                ),
              },
            ],
            details: {},
          };
        }

        // 2. Promote proposal
        const promoResult = await promoteProposal({
          target: params.target as ImprovableTarget,
          candidateContent: params.newContent,
          candidateScore: sandboxResult.score,
          rationale: params.rationale,
          detail: sandboxResult.detail,
          proposalId,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: promoResult.decision.toUpperCase(),
                  message: promoResult.message,
                  newVersion: promoResult.version,
                  baseline: promoResult.baselineScore,
                  candidateScore: promoResult.candidateScore,
                  delta: promoResult.delta,
                  archivedPath: promoResult.archivedPath,
                },
                null,
                2
              ),
            },
          ],
          details: {},
        };
      } catch (err: unknown) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error during proposal evaluation: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: {},
        };
      }
    },
  });

  return [
    listImprovableFilesTool,
    readImprovableFileTool,
    getEvalReportTool,
    proposeChangeTool,
  ];
}
