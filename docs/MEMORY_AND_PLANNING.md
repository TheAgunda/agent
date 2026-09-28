# Project Memory & Planning

## Memory (`memory_entries` table)

Rows in `.agent/agent.db` grouped into categories: Architecture Decisions, Coding
Conventions, Important Commands, Project Requirements, User Preferences, Known Issues, Previous
Task Results. The agent currently writes to it automatically for a couple of high-signal events
(dependency installs, commits) and a compact version is injected into every system prompt
(`MemoryManager.summaryForPrompt()`).

Manage it from the CLI: `agent memory` (list with ids), `agent memory add preference "Prefer named
exports"`, `agent memory forget <id>`, and `agent memory export` (renders markdown). Each category is
capped at `memory.maxEntries`; the oldest rows are pruned on insert.

Disable with `memory.enabled: false`; cap retained entries per category with `memory.maxEntries`.

## Planning (`plans` + `plan_tasks` tables)

When `agent.planningEnabled` is true, the loop makes one LLM call up front
(`Planner.createPlan`) that turns the goal into an ordered JSON task list, stored as one
`plans` row plus ordered `plan_tasks` rows (the newest plan is the current one). The checklist is re-rendered into the
system prompt every iteration, and the model is instructed to call `update_task_status(taskId,
status, notes?)` as it works — this is the one "tool" that isn't backed by `ToolRegistry`/the
filesystem; `AgentLoop` intercepts it directly and calls `Planner.updateTaskStatus`.

`agent plan "<goal>"` generates and prints a plan without executing anything — useful to sanity
check the breakdown before committing to a full `agent run`.

Fallback behavior: if the model never calls `update_task_status`, individual task statuses stay
`pending`/`in_progress`, but the loop still runs to completion — when a `TASK_COMPLETE:` signal is
seen, all remaining tasks are marked `done` as a safety net so the plan reflects reality even if
per-task tracking wasn't granular.
