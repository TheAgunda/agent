# Database

All agent state is stored in SQLite at `<project>/.agent/agent.db` (via `better-sqlite3`; WAL
journal, `foreign_keys = ON`). Configuration remains YAML because it is hand-edited settings, not
agent state. Add `.agent/agent.db*` to `.gitignore` (the bundled `.gitignore` already does).

## Schema (version tracked in `PRAGMA user_version`)

| Table | Purpose |
|---|---|
| `sessions` | One row per run: goal, status (`running/completed/failed/interrupted`), iterations, summary, plan id |
| `messages` | Ordered transcript (`session_id, seq`), role + content, tool-result linkage |
| `tool_calls` | Tool calls requested by an assistant message (name + arguments text) |
| `plans` / `plan_tasks` | A plan and its ordered tasks; status is a CHECK-constrained column |
| `memory_entries` | Project memory rows by category, pruned to `memory.maxEntries` per category |
| `tool_runs` | Audit log of every executed tool: args, ok/fail, output (truncated to 20 KB), duration |

Tool-call arguments are free-form per tool, so they are stored as a JSON-encoded text column; every
other field is a typed, constrained column.

## Migrations

`src/db/index.ts` holds an ordered, append-only `MIGRATIONS` array. On open, every migration newer
than `user_version` runs inside a transaction. Never edit an existing entry; add a new one.

## Useful queries

```sql
-- what did the agent do last run?
SELECT tool_name, ok, duration_ms FROM tool_runs ORDER BY id DESC LIMIT 20;
-- failing tools
SELECT tool_name, substr(output,1,200) FROM tool_runs WHERE ok = 0;
-- plan progress
SELECT status, description FROM plan_tasks ORDER BY plan_id, position;
-- session outcomes
SELECT status, count(*) FROM sessions GROUP BY status;
```

## Upgrading from the JSON version

Earlier builds wrote `.agent/sessions/*.json`, `.agent/plans/*.json` and `.agent/memory.md`. These
are no longer read. Old history is not migrated automatically; `agent memory add ...` can re-seed
memory. Deleting the old folders is safe.
