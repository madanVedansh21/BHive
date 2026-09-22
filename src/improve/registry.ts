// =============================================================================
// src/improve/registry.ts — Allowlist + cache-busting loader for strategies.
//
// Strategies are loaded DYNAMICALLY (never statically imported) so the
// orchestrator always reads the current on-disk version at load time.
// Hot swap = require.resolve -> delete require.cache -> require again.
//
// Security: targets are validated against ALLOWED_TARGETS before resolving,
// so a stray or malicious target name can never escape src/strategies/.
// =============================================================================

import * as path from "path";
import { MemoryStrategy } from "./types";

/** Targets an improvement proposal may ever touch. Extend deliberately. */
export const ALLOWED_TARGETS = ["memory"] as const;
export type ImprovableTarget = (typeof ALLOWED_TARGETS)[number];

/** Resolved against __dirname so it works under ts-node (src/) AND compiled JS (dist/). */
const STRATEGY_ROOT = path.resolve(__dirname, "..", "strategies");

export function isAllowedTarget(target: string): target is ImprovableTarget {
  return (ALLOWED_TARGETS as readonly string[]).includes(target);
}

/**
 * Load the latest on-disk implementation for a target.
 * Called per tick / per improvement cycle — never held across a swap boundary.
 */
export function loadStrategy(target: ImprovableTarget): MemoryStrategy {
  if (!isAllowedTarget(target)) {
    throw new Error(`Unknown improvable target: ${target}`);
  }

  const modulePath = require.resolve(path.join(STRATEGY_ROOT, target, "default"));
  delete require.cache[modulePath]; // ← this IS the hot reload
  const mod = require(modulePath) as {
    strategy?: MemoryStrategy;
    default?: MemoryStrategy;
  };

  const strategy = mod.strategy ?? mod.default;
  if (
    !strategy ||
    typeof strategy.buildContext !== "function" ||
    typeof strategy.applyTickToMemory !== "function"
  ) {
    throw new Error(
      `Strategy "${target}" does not satisfy the MemoryStrategy contract.`
    );
  }
  return strategy;
}
