// =============================================================================
// src/env.ts — Automatic .env file loader for BHive.
// =============================================================================

import * as fs from "fs";
import * as path from "path";

export function loadEnv(envPath: string = path.resolve(process.cwd(), ".env")): void {
  if (!fs.existsSync(envPath)) return;

  try {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) continue;

      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();

      // Strip surrounding quotes
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }

      // Only set if not already provided in process.env
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch (err) {
    console.warn(`[env] Warning: failed to parse ${envPath}:`, err);
  }
}

// Auto-run on import
loadEnv();
