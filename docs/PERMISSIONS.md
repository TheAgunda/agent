# Permissions

Every tool call goes through `PermissionManager.authorize()` (src/permissions/index.ts) before
`ToolRegistry` executes it. Nothing bypasses this — including tool calls made from `agent chat`
and `agent run`.

## Modes (`permissions.mode`)

| Mode | Reads | Writes/exec | Destructive (delete) |
|---|---|---|---|
| `safe` | always allowed | **blocked outright** | blocked outright |
| `ask` | always allowed | confirm every time | confirm every time |
| `auto` | always allowed | run freely* | **always** confirm |

\* unless the specific tool name is listed in `permissions.requireConfirmationFor`.

`agent ask` always runs with an effective `safe` override regardless of the configured mode,
since it's meant to be a read-only Q&A command — even if you configure `mode: auto` project-wide.

## Path containment

Any tool call with a `path` argument and `riskLevel !== 'read'` is checked against the project
root. If it resolves outside (e.g. `../../etc/passwd`, an absolute path elsewhere), it's refused
unconditionally — this is not a permission-mode decision, it applies even in `auto` mode — unless
`permissions.allowEditOutsideProject: true` is set.

## Command blocklist

`permissions.blockedCommands` is a list of substrings checked against any `run_command` /
`install_dependency` invocation, case-insensitively. A match refuses the command **under every
mode**, including `auto`. The default list covers destructive filesystem wipes, fork bombs,
privilege escalation, and pipe-to-shell patterns. Extend it in your project config:

```yaml
permissions:
  blockedCommands:
    - "rm -rf /"
    - "docker system prune -a"   # example project-specific addition
```

This is a blocklist, not a sandbox — it catches known-dangerous patterns, not every possible
harmful command. Use `safe` mode for untrusted tasks/models, and review diffs (`git_diff`) before
committing in higher-autonomy modes.

## Confirmation flow

When a decision requires confirmation, the CLI prompts interactively (inquirer) showing the tool
name and a summary of its arguments. `--yes`/`-y` or a non-TTY session **declines** anything
requiring confirmation rather than hanging — the agent then has to adapt (e.g. explain in
`TASK_BLOCKED:` that it needs permission for something).

## Programmatic use

`PermissionManager.evaluate()` is a pure, synchronous policy check (no prompting) — useful for
tests or for building an alternate UI. `authorize()` wraps it with the actual confirm callback.
