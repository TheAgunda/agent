# Architecture

```
CLI (src/cli)
 │  commander-based; each command builds config → provider → AgentLoop and wires console output
 │
 ├── Agent Core (src/agent)
 │    ├── loop.ts          – the agentic loop itself (plan → context → model → tools → repeat)
 │    └── promptBuilder.ts – assembles the system prompt from project context, memory, plan
 │
 ├── Context (src/context)
 │    ├── indexer.ts   – walks the repo respecting .gitignore + built-in ignores; detects
 │    │                   languages/frameworks/package managers/git/test commands
 │    ├── selector.ts  – relevance-scores files against the task + recently-touched files,
 │    │                   greedily fills a token budget
 │    └── manager.ts   – orchestrates indexer+selector into a ready-to-inject prompt block,
 │                        re-run every iteration so context tracks edits made mid-task
 │
 ├── Planning (src/planning/planner.ts)
 │    – one LLM call turns a goal into an ordered task list; persisted to .agent/plans/;
 │      the model updates task status itself via the `update_task_status` tool
 │
 ├── Memory (src/memory/index.ts)
 │    – append-only, human-editable .agent/memory.md, grouped by category (decisions,
 │      conventions, commands, requirements, preferences, issues, results)
 │
 ├── Session (src/session/index.ts)
 │    – full message history + status persisted per run to .agent/sessions/<id>.json,
 │      enabling `agent resume`
 │
 ├── Providers (src/providers)
 │    ├── base.ts             – LLMProvider abstract base
 │    ├── openaiCompatible.ts – the one HTTP client; speaks the OpenAI chat-completions
 │    │                         wire format (SSE streaming + tool_calls), used for every
 │    │                         provider since they all implement this surface
 │    └── registry.ts         – maps config.model.provider → concrete provider + default baseUrl
 │
 ├── Tools (src/tools)
 │    ├── filesystem.ts – read/write/edit/delete/list/search
 │    ├── shell.ts       – run_command, install_dependency (spawned with a hard timeout)
 │    ├── git.ts         – status/diff/log/commit via simple-git
 │    ├── testing.ts     – run_tests/run_linter/run_formatter (project-detected or configured)
 │    └── registry.ts    – ties tools together, enforces permissions before every execution
 │
 ├── Permissions (src/permissions/index.ts)
 │    – single gatekeeper: path containment, command blocklist, mode-based policy
 │
 └── UI (src/ui/console.ts)
      – plain functions returning formatted strings (banner, status/tool lines, plan render);
        commands are responsible for calling console.log with them so streaming isn't blocked
```

## The agent loop

`AgentLoop.run(goal)` (src/agent/loop.ts):

1. Build initial project context (`ContextManager.buildContext`) and, if `agent.planningEnabled`,
   create or reuse a plan via one `Planner.createPlan` call.
2. Loop until `agent.maxIterations`:
   - Rebuild context every iteration (cheap: file list is cached; only the *selection* re-runs)
     so edits made in this same task are visible to the next turn.
   - Rebuild the system prompt (project summary, relevant file contents, memory summary, current
     plan checklist).
   - Call the provider with the full tool list plus `update_task_status`.
   - If the model returns tool calls: execute each via `ToolRegistry` (which checks permissions,
     prompting for confirmation when required), append results as `tool` messages, and continue.
   - If the model returns no tool calls: check for a `TASK_COMPLETE:` / `TASK_BLOCKED:` prefix to
     end the loop with a clear status; otherwise nudge it once to make an explicit choice rather
     than silently looping on ambiguous chatter.
3. Persist the session after every iteration (`SessionStore`), so a crash or Ctrl-C leaves state
   `agent resume` can pick up.

Completion is signaled by the model's own text (`TASK_COMPLETE:`/`TASK_BLOCKED:`) rather than a
separate tool, keeping the tool surface small and making the signal visible directly in the
transcript.

## Context management

Two problems solved by `src/context`:

- **"What is this project?"** (`indexer.ts`) — cheap, structural facts: languages by extension
  count, frameworks by dependency/manifest-file signals, package manager by lockfile presence,
  git branch from `.git/HEAD`, and test/lint/format commands from `package.json` scripts or
  Python conventions. This is a summary block, not file contents, and is cheap to recompute.

- **"Which files actually matter for this task?"** (`selector.ts`) — a keyword-overlap score
  between the task description and each file's path (plus small boosts for manifests/READMEs,
  recently-touched files, and shallower paths), sorted and greedily packed into a token budget
  (`agent.contextLimit`). This intentionally avoids an embeddings/vector-store dependency: it's
  fast, has zero extra infrastructure, and is transparent enough that `agent context <query>`
  can show exactly why a file was or wasn't included. For very large, semantically diverse
  monorepos, this heuristic will sometimes miss non-obviously-named relevant files — the
  `search_files`/`grep`-style tool exists precisely so the model can compensate by searching for
  symbols/strings it expects to exist. A vector-search backend could be added as an additional
  scoring signal in `selectRelevantFiles` without changing its interface.

`recentlyTouched` files (tracked from `write_file`/`edit_file`/`delete_file` tool calls) get a
relevance boost so the next turn keeps seeing files the agent just changed, even if their path
doesn't match the task's keywords.

## Error recovery

There's no separate "error recovery" module — it's a property of the loop: tool results
(including failures, stderr, non-zero exit codes) are fed back to the model as `tool` messages,
and the system prompt instructs it to read errors, inspect relevant files, and fix root causes
rather than retry blindly. `agent.maxIterations` is the hard backstop against infinite loops. A
future improvement noted in the code (`agent.maxRetriesPerTask`) is defined in config but not yet
enforced per-task — see [DEVELOPMENT.md](./DEVELOPMENT.md#known-gaps).

## Extending

- **New tool**: implement the `Tool` interface (src/tools/types.ts), add it to the relevant array
  in src/tools/*.ts, and it's automatically registered. See [TOOLS.md](./TOOLS.md).
- **New provider**: if it speaks the OpenAI chat-completions format, just add it to
  `src/providers/registry.ts` with a default base URL — no new client code needed. For a
  genuinely different wire format, implement `BaseProvider` (src/providers/base.ts).
