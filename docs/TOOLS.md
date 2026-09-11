# Tools

All tools return `{ ok, output, data?, error?, fatal? }`. `output` is what's fed back to the
model as the tool result message, so it's written to be model-readable (e.g. numbered file lines,
`$ command\n<stdout>\n--- stderr ---\n<stderr>`).

| Tool | Risk level | Description |
|---|---|---|
| `read_file` | read | Read a file, optionally a line range. Returns numbered lines. |
| `list_directory` | read | List entries at a path (`d`/`f` prefix). |
| `search_files` | read | Regex/text search across the project, returns `file:line: text`. |
| `git_status` / `git_diff` / `git_log` | read | Git inspection via simple-git. |
| `write_file` | write | Create or fully overwrite a file (creates parent dirs). |
| `edit_file` | write | Exact find-and-replace; fails loudly if `oldText` is missing or not unique, rather than guessing. |
| `install_dependency` | write | Run a package-manager install command. |
| `run_command` | exec | Arbitrary shell command, captured (not a PTY), with a timeout. |
| `run_tests` / `run_linter` / `run_formatter` | exec | Runs the configured/detected command; accepts an `command` override argument. |
| `git_commit` | write | Stages all tracked changes and commits; never force-pushes/rewrites history. |
| `delete_file` | destructive | Always requires confirmation, even in `auto` permission mode. |
| `update_task_status` | read | Not filesystem-backed — updates the in-memory/persisted plan directly (handled specially in `AgentLoop`, not `ToolRegistry`). |

Every write/exec/destructive tool is routed through `PermissionManager` before it runs — see
[PERMISSIONS.md](./PERMISSIONS.md).

## Adding a custom tool

1. Implement the `Tool` interface:

```ts
// src/tools/myTool.ts
import type { Tool, ToolContext } from './types.js';
import { ok, fail } from './types.js';

export const myTool: Tool = {
  definition: {
    name: 'my_tool',
    description: 'What this does, written for the model to understand when to call it.',
    parameters: {
      type: 'object',
      properties: { arg: { type: 'string', description: '...' } },
      required: ['arg'],
    },
    riskLevel: 'read', // read | write | exec | destructive
  },
  async execute(args, ctx: ToolContext) {
    // ctx.projectRoot, ctx.commands are available
    return ok('result for the model');
    // or: return fail('what went wrong');
  },
};
```

2. Add it to the relevant array (or a new one) and include it in `ToolRegistry`'s constructor
   (`src/tools/registry.ts`).

3. Pick `riskLevel` honestly — it determines whether `safe` mode blocks it and whether `auto`
   mode still asks for confirmation (`destructive` always does).

No other wiring is needed: the tool immediately shows up in `provider.complete()`'s `tools`
list and in permission evaluation.
