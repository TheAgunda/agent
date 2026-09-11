# Project Memory & Planning

## Memory (`.agent/memory.md`)

A plain, human-editable markdown file grouped into categories: Architecture Decisions, Coding
Conventions, Important Commands, Project Requirements, User Preferences, Known Issues, Previous
Task Results. The agent currently writes to it automatically for a couple of high-signal events
(dependency installs, commits) and a compact version is injected into every system prompt
(`MemoryManager.summaryForPrompt()`).

It's deliberately a flat markdown file rather than a database or vector store: most durable facts
about a project (its conventions, past decisions, known gotchas) fit in a few KB, and keeping it
as plain markdown means you can read and hand-edit it directly — useful for seeding the agent
with context you already know (`.agent/memory.md` → add a `## User Preferences` line like `- User
prefers named exports over default exports`).

Disable with `memory.enabled: false`; cap retained entries per category with `memory.maxEntries`.

## Planning (`.agent/plans/`)

When `agent.planningEnabled` is true, the loop makes one LLM call up front
(`Planner.createPlan`) that turns the goal into an ordered JSON task list, persisted as
`.agent/plans/<id>.json` (plus a `latest.json` pointer). The checklist is re-rendered into the
system prompt every iteration, and the model is instructed to call `update_task_status(taskId,
status, notes?)` as it works — this is the one "tool" that isn't backed by `ToolRegistry`/the
filesystem; `AgentLoop` intercepts it directly and calls `Planner.updateTaskStatus`.

`agent plan "<goal>"` generates and prints a plan without executing anything — useful to sanity
check the breakdown before committing to a full `agent run`.

Fallback behavior: if the model never calls `update_task_status`, individual task statuses stay
`pending`/`in_progress`, but the loop still runs to completion — when a `TASK_COMPLETE:` signal is
seen, all remaining tasks are marked `done` as a safety net so the plan reflects reality even if
per-task tracking wasn't granular.
