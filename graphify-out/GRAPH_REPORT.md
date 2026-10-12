# Graph Report - BHive  (2026-10-12)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 400 nodes · 737 edges · 15 communities (12 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `66372ca1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- uiServer.ts
- bhiveStore.ts
- promoter.ts
- ui/package.json
- package.json
- src/types.ts
- orchestrator.ts
- sandbox.ts
- platformClient.ts
- compilerOptions
- compilerOptions
- scripts

## God Nodes (most connected - your core abstractions)
1. `useBHiveStore` - 23 edges
2. `compilerOptions` - 16 edges
3. `compilerOptions` - 16 edges
4. `App()` - 12 edges
5. `scripts` - 12 edges
6. `AgentMemory` - 11 edges
7. `loadStrategy()` - 11 edges
8. `buildPlatformTools()` - 11 edges
9. `runImprovementCycle()` - 10 edges
10. `startUIServer()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `HistoryEntry` --references--> `ImprovableTarget`  [EXTRACTED]
  src/improve/promoter.ts → src/improve/registry.ts
- `PromoteOptions` --references--> `ImprovableTarget`  [EXTRACTED]
  src/improve/promoter.ts → src/improve/registry.ts
- `PromotionResult` --references--> `ImprovableTarget`  [EXTRACTED]
  src/improve/promoter.ts → src/improve/registry.ts
- `StrategyState` --references--> `ImprovableTarget`  [EXTRACTED]
  src/improve/promoter.ts → src/improve/registry.ts
- `runImprovementCycle()` --calls--> `buildImproveTools()`  [EXTRACTED]
  src/improve/improveSession.ts → src/improveTools.ts

## Import Cycles
- None detected.

## Communities (15 total, 3 thin omitted)

### Community 0 - "uiServer.ts"
Cohesion: 0.06
Nodes (42): cors, express, ActiveProcess, activeProcesses, CommandRequest, executeCommand(), getActiveCommands(), killCommand() (+34 more)

### Community 1 - "bhiveStore.ts"
Cohesion: 0.11
Nodes (35): react, App(), PRESETS, TerminalConsole(), useWebSocket(), NAV, Sidebar(), TopBar() (+27 more)

### Community 2 - "promoter.ts"
Cohesion: 0.08
Nodes (40): fs, path, targets, AssertionResult, AssertionSpec, CaseResult, EvalRunResult, loadDataset() (+32 more)

### Community 3 - "ui/package.json"
Cohesion: 0.05
Nodes (37): typescript, autoprefixer, lucide-react, postcss, react-dom, react-force-graph-2d, recharts, tailwindcss (+29 more)

### Community 4 - "package.json"
Cohesion: 0.06
Nodes (37): author, dependencies, @anthropic-ai/sdk, cors, @earendil-works/pi-coding-agent, express, @google/generative-ai, openai (+29 more)

### Community 5 - "src/types.ts"
Cohesion: 0.10
Nodes (20): EvalCase, buildJudgePrompt(), JUDGE_SAMPLES, judgeContextPrompt(), JudgeDimScores, JudgeResult, JudgeRunResult, median() (+12 more)

### Community 6 - "orchestrator.ts"
Cohesion: 0.12
Nodes (25): @earendil-works/pi-coding-agent, runAgentTick(), agentExists(), agentPath(), agentsDir, ensureDir(), listAgentIds(), loadAgent() (+17 more)

### Community 7 - "sandbox.ts"
Cohesion: 0.09
Nodes (25): AgentIdentity, AgentMemory, AssertionSpec, ChildToParentMsg, EvalCase, loadDataset(), MemoryStrategy, ParentToChildMsg (+17 more)

### Community 8 - "platformClient.ts"
Cohesion: 0.22
Nodes (19): ackNotification(), apiFetch(), Comment, createComment(), CreateCommentResult, createPost(), CreatePostResult, FeedPost (+11 more)

### Community 9 - "compilerOptions"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, declarationMap, esModuleInterop, ignoreDeprecations, lib, module, moduleResolution (+9 more)

### Community 10 - "compilerOptions"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+9 more)

### Community 11 - "scripts"
Cohesion: 0.17
Nodes (12): scripts, build, eval, improve, orchestrate, postinstall, register, rollback (+4 more)

## Knowledge Gaps
- **11 isolated node(s):** `autoprefixer`, `lucide-react`, `postcss`, `tailwindcss`, `@types/react` (+6 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 207 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `typescript` connect `ui/package.json` to `package.json`?**
  _High betweenness centrality (0.303) - this node is a cross-community bridge._
- **What connects `autoprefixer`, `lucide-react`, `postcss` to the rest of the system?**
  _11 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `uiServer.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.055904961565338925 - nodes in this community are weakly interconnected._
- **Why does `@earendil-works/pi-coding-agent` connect `orchestrator.ts` to `uiServer.ts`, `platformClient.ts`, `promoter.ts`, `package.json`?**
  _High betweenness centrality (0.181) - this node is a cross-community bridge._
- **Should `bhiveStore.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10980392156862745 - nodes in this community are weakly interconnected._
- **Why does `react` connect `bhiveStore.ts` to `ui/package.json`?**
  _High betweenness centrality (0.104) - this node is a cross-community bridge._
- **Should `promoter.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08078231292517007 - nodes in this community are weakly interconnected._