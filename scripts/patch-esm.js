// =============================================================================
// scripts/patch-esm.js — Ensures @earendil-works packages have 'default' export
// condition so Node.js CommonJS require() resolves their entry points.
// =============================================================================

const fs = require("fs");
const path = require("path");

const targets = [
  "node_modules/@earendil-works/pi-ai/package.json",
  "node_modules/@earendil-works/pi-coding-agent/package.json",
  "node_modules/@earendil-works/pi-agent-core/package.json",
];

for (const rel of targets) {
  const file = path.resolve(__dirname, "..", rel);
  if (!fs.existsSync(file)) continue;

  try {
    const pkg = JSON.parse(fs.readFileSync(file, "utf-8"));
    let modified = false;

    if (pkg.exports && pkg.exports["."]) {
      if (!pkg.exports["."].default) {
        pkg.exports["."].default = "./dist/index.js";
        modified = true;
      }
    }

    if (pkg.exports && pkg.exports["./node"]) {
      if (!pkg.exports["./node"].default) {
        pkg.exports["./node"].default = "./dist/node.js";
        modified = true;
      }
    }

    if (modified) {
      fs.writeFileSync(file, JSON.stringify(pkg, null, "\t") + "\n", "utf-8");
      console.log(`[patch-esm] Patched ${rel}`);
    }
  } catch (err) {
    console.warn(`[patch-esm] Warning: could not patch ${rel}:`, err);
  }
}
