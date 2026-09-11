# agent — a local-first autonomous coding CLI

A terminal-based coding agent that plans, writes, runs, tests, and fixes code across a whole
project from a single natural-language prompt — designed to run primarily against **local /
open-source LLMs** (Qwen3 30B and similar) via Ollama, llama.cpp, or vLLM, but works with any
OpenAI-compatible endpoint (including OpenAI itself).

```bash
agent run "Build a REST API with FastAPI and PostgreSQL, with tests"
```

## Why local-first

Every backend this project talks to — Ollama, llama.cpp's `llama-server`, vLLM, OpenAI, or any
other "OpenAI-compatible" server — implements the same `/v1/chat/completions` wire format. The
agent has exactly one HTTP client (`OpenAICompatibleProvider`) and just points it at a different
base URL per provider. There's no special-cased "local model" code path with fewer features;
local models get the same tool-calling loop, planning, and context management as hosted ones.

## Quick start

```bash
# 1. Install
npm install
npm run build
npm link          # makes the `agent` command available globally, or use `node dist/cli/index.js`

# 2. Start a local model (example: Ollama + Qwen3 30B)
ollama pull qwen3:30b
ollama serve

# 3. In your project directory
cd my-project
agent init         # writes .agent/config.yaml, pick "ollama" / "qwen3:30b" when prompted
agent run "Add input validation to the signup endpoint and write tests for it"
```

No local model handy? Point it at OpenAI or any other compatible endpoint:

```bash
chmod +x dist/cli/index.js
agent --help
agent init                       # choose provider "openai", model "gpt-4o-mini" (or similar)
export OPENAI_API_KEY=sk-...
agent run "..."
```

## Commands

| Command | Description |
|---|---|
| `agent init` | Interactively create `.agent/config.yaml` for the current project |
| `agent run "<task>"` | One-shot autonomous execution of a task, looping until done |
| `agent chat` | Interactive multi-turn session in the terminal |
| `agent plan "<goal>"` | Generate (but don't execute) a task checklist for a goal |
| `agent ask "<question>"` | Read-only Q&A about the codebase (no writes, no exec) |
| `agent resume` | Continue the most recent interrupted/incomplete session |
| `agent history` | List recent sessions |
| `agent status` | Project info, model connectivity, latest session/plan |
| `agent context [query]` | Preview which files would be selected as context for a query |
| `agent models` | Check provider connectivity and list models on that endpoint |
| `agent config [show\|path]` | Print the resolved configuration |

Flags available on most commands: `-y, --yes` (never prompt for confirmation — declines anything
that would need it), `--permissions <safe\|ask\|auto>`, `--model <name>`, `--provider <name>`.

## How it works

```
User Request
     │
     ▼
Analyze Project (indexer: languages, frameworks, git, test/lint commands)
     │
     ▼
Create Plan (LLM call → ordered task checklist, persisted to .agent/plans/)
     │
     ▼
┌──► Select Relevant Context (token-budgeted, relevance-scored file selection)
│         │
│         ▼
│    Call Model with Tools (streamed; may request 0..N tool calls)
│         │
│         ▼
│    Execute Tools (permission-checked: read/write/exec/destructive)
│         │
│         ▼
│    Feed Results Back to Model
│         │
│         ▼
└──  Repeat until "TASK_COMPLETE: ..." / "TASK_BLOCKED: ..." / max_iterations
```

Every turn re-selects context (so it stays relevant as files are edited), re-renders the current
plan into the prompt, and persists the full session to `.agent/sessions/<id>.json` so `agent
resume` can pick up exactly where it left off.

## Tools available to the model

`read_file`, `write_file`, `edit_file` (find/replace), `delete_file`, `list_directory`,
`search_files`, `run_command`, `install_dependency`, `run_tests`, `run_linter`, `run_formatter`,
`git_status`, `git_diff`, `git_log`, `git_commit`, and `update_task_status` (for the model to
track its own plan progress). See [docs/TOOLS.md](docs/TOOLS.md) for full definitions.

## Safety

Nothing executes without going through `PermissionManager`:

- **Reads are always allowed.** Writes/exec/destructive actions follow `permissions.mode`:
  `safe` (blocked entirely), `ask` (confirm every time), `auto` (run freely, except destructive
  actions like `delete_file`, which always confirm).
- **Path containment**: file tools refuse to touch anything that resolves outside the project
  root unless `permissions.allowEditOutsideProject: true`.
- **Command blocklist**: patterns like `rm -rf /`, `sudo rm`, fork bombs, `curl | sh`, etc. are
  refused under every permission mode, not just `safe`.
- **Timeouts**: shell commands are killed after a configurable timeout rather than hanging forever.

See [docs/PERMISSIONS.md](docs/PERMISSIONS.md) for the full policy and how to configure it.

## Documentation

- [docs/INSTALLATION.md](docs/INSTALLATION.md) — install, and set up Qwen3 30B / Ollama / vLLM / llama.cpp
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md) — every config key, global vs project config, env vars
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module map, the agent loop, context management
- [docs/TOOLS.md](docs/TOOLS.md) — full tool reference and how to add a custom tool
- [docs/PERMISSIONS.md](docs/PERMISSIONS.md) — permission modes and policy details
- [docs/MEMORY_AND_PLANNING.md](docs/MEMORY_AND_PLANNING.md) — how persistent memory and planning work
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — running tests, project layout, adding a provider
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — common problems

## Known limitations

- Context selection is keyword/heuristic-based, not embeddings-based (no vector DB dependency).
  This works well up to tens of thousands of files but is not semantic search — see
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#context-management) for the reasoning and how to
  extend it.
- `update_task_status` relies on the model choosing to call it; a model that ignores the
  instruction will still complete the task, just without granular per-task status in the plan
  (the plan is marked fully done on `TASK_COMPLETE` as a fallback).
- `run_command` captures output rather than being truly interactive (no PTY), so commands that
  require a TTY or interactive stdin (e.g. some scaffolding wizards) won't work well; pass
  non-interactive flags where the underlying tool supports them.
- Tested against Ollama's, and a scripted mock server's, OpenAI-compatible `/v1/chat/completions`
  surface. vLLM and llama.cpp implement the same surface but have not been exercised against a
  live instance in this environment — see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) if
  you hit a rough edge with a specific server.

## License

MIT
