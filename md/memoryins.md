# PROJECT OVERVIEW
This project is a minimal TypeScript application that sets up a local AI coding agent using the `@earendil-works/pi-coding-agent` SDK. Currently, it implements a single interactive AI session via a command-line `readline` loop. 

# BUSINESS PURPOSE
The current scaffold allows a user to interact with an AI agent in the terminal. Based on project goals, it is intended to be evolved into an orchestrator and agent system simulating autonomous participants on a platform.

# TECH STACK
- **Language**: TypeScript, Node.js
- **Dependencies**: `@earendil-works/pi-coding-agent`, `typebox`
- **Infrastructure**: Local Node execution

# REPOSITORY STRUCTURE
- `src/index.ts` - Main entry point containing the agent setup and interactive loop.
- `package.json` - Defines project metadata and dependencies.
- `tsconfig.json` - TypeScript compiler configuration.

# SYSTEM ARCHITECTURE
CLI Application ↓ `@earendil-works/pi-coding-agent` SDK ↓ LLM Provider

- **Frontend**: N/A (CLI interface via `readline`)
- **Backend**: Single Node.js script setting up an Agent Session.
- **Database**: N/A. (Future state will use local JSON files).
- **Authentication**: Managed internally by Pi SDK via `AuthStorage`.
- **External Services**: Anthropic API (for LLM model `claude-opus-4-5`)

# ROUTING MAP
N/A - This is a CLI application, not a web server. There are no routes.

# FRONTEND ARCHITECTURE
N/A - CLI application.

# BACKEND ARCHITECTURE
- **`src/index.ts`**: Initializes AuthStorage, ModelRegistry, SettingsManager, and ResourceLoader. It defines a custom tool (`custom_status`) and enters an interactive `readline` loop to prompt the agent.

# DATABASE MAP
N/A - No database is currently connected. Future state will use local JSON files inside an `agents/` directory.

# AUTHENTICATION FLOW
Authentication is handled via the SDK's `AuthStorage` (`.pi/agent/auth.json`), with optional runtime override via the `MY_KEY` environment variable.

# API INVENTORY
N/A - This project does not expose any APIs. It is a local CLI tool.

# DATA FLOW DIAGRAMS
User Input (stdin) ↓ `session.prompt()` ↓ Pi SDK ↓ LLM Response ↓ Console Output (stdout)

# ENVIRONMENT VARIABLES
- `MY_KEY` - Optional runtime API key override for the `anthropic` provider.

# THIRD PARTY INTEGRATIONS
- **Pi SDK**: Handles agent session management, tool execution, and LLM communication.

# FEATURE INVENTORY
- **Agent Initialization**: Sets up a Pi agent session with read/write/bash tools.
- **Interactive Loop**: Reads user input from stdin and passes it to the agent.
- **Custom Tool**: Includes a sample `custom_status` tool to report process uptime.

# DEPENDENCY GRAPH
`src/index.ts` depends on:
- `@earendil-works/pi-coding-agent` (AuthStorage, createAgentSession, DefaultResourceLoader, defineTool, ModelRegistry, SessionManager, SettingsManager)
- `@earendil-works/pi-ai` (getModel)
- `typebox` (Type)

External Dependencies:
- Node.js Built-ins: `readline`, `process`

# IMPORTANT FILES
- `src/index.ts` - The entry point and entire application logic.

# PERFORMANCE NOTES
- Synchronous readline loop.

# TECHNICAL DEBT
- Hardcoded to use `claude-opus-4-5` from `anthropic`.

# DEVELOPMENT WORKFLOW
- Build via TypeScript (`tsc`).
- Run via `ts-node` or compiled JS.

# DEPLOYMENT PROCESS
N/A - Runs locally.

# KNOWN RISKS
- Missing error handling for missing `.pi` directory structure (though SDK may auto-create).

# FUTURE RECOMMENDATIONS
- Refactor into the planned multi-agent simulation orchestrator.
