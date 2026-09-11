# Troubleshooting

## `.agent already exists`

`agent init` refuses to overwrite an existing `.agent/` directory. Edit `.agent/config.yaml`
directly, or `rm -rf .agent` first if you want to start over (this deletes memory/plans/sessions
too).

## Model provider unreachable

`agent status` / `agent run` report `reachable: no (...)`. Checklist:

- Is the server actually running? (`ollama serve`, `llama-server`, vLLM's API server, ...)
- Does `model.baseUrl` in `.agent/config.yaml` match the port it's on?
- For Ollama specifically: the OpenAI-compatible surface is at `/v1`, e.g.
  `http://localhost:11434/v1`, not `http://localhost:11434`.
- `agent models` hits `<baseUrl>/models` directly and prints the raw failure detail.

## "Could not find the given text" from `edit_file`

The model's `oldText` didn't match the file's current exact content (whitespace, line endings, or
the file changed since it last read it). The agent is instructed to re-read before editing; if it
still fails, it will see the error message and can retry with corrected text — this is expected
recoverable behavior, not a bug, as long as it does retry. If it doesn't, nudge it via `agent
chat` or refine the task description.

## Loop reaches `maxIterations` without completing

- Check the transcript (`.agent/sessions/<id>.json`) for repeated failures on the same step —
  usually a command genuinely failing the same way each time (missing dependency, wrong test
  command). Fix the underlying issue and `agent resume`.
- Increase `agent.maxIterations` for larger tasks.
- If the model keeps producing prose with no tool calls and no `TASK_COMPLETE`/`TASK_BLOCKED`
  marker, it may not be following instructions well — try a larger/more capable model, or set
  `systemPrompt` to reinforce the convention more strongly for models that need it.

## Permission denials

`agent run --yes` (or a non-interactive session) **declines** anything needing confirmation
rather than hanging — this can look like the agent "giving up" on something it should be able to
do. Either run interactively so you can approve prompts, or set `permissions.mode: auto` if you
trust the task.

## Everything blocked in `safe` mode

That's the mode working as intended — `safe` is read-only by design. Switch to `ask` or `auto` in
`.agent/config.yaml` or via `--permissions ask`.

## Streaming looks wrong against a custom OpenAI-compatible server

Some servers return non-standard SSE framing or omit fields the client expects (`finish_reason`,
`tool_calls` deltas). `OpenAICompatibleProvider.consumeStream` (src/providers/openaiCompatible.ts)
is where to add server-specific handling; consider also just sending `stream: false` for that
provider if it doesn't support streaming tool calls reliably — the non-streaming path
(`messageToChunk`) is simpler and often more robust for less common servers.
