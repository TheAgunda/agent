# Development Guide

## Layout

```
src/
  agent/        the loop + prompt builder
  cli/          commander wiring + per-command implementations
  config/       schema, layered loading, validation
  context/      indexer, selector, manager
  memory/       .agent/memory.md persistence
  permissions/  the single gatekeeper for write/exec/destructive actions
  planning/     plan generation + tracking
  providers/    LLM client(s)
  session/      .agent/sessions/*.json persistence for resume/history
  tools/        filesystem/shell/git/testing tool implementations + registry
  types/        shared TypeScript types
  ui/           console formatting helpers (pure functions, no I/O)
  __tests__/    vitest suite (see below)
```

## Running locally

```bash
npm install
npm run dev -- status              # tsx, no build step
npm run typecheck
npm run build
npm test                           # vitest run, 46 tests as of this writing
```

## Test strategy

- **Unit tests** for pure logic: config merging/validation, permission decisions, the
  indexer/selector, memory persistence, planner parsing.
- **Integration tests** (`agentLoop.test.ts`) run the real `AgentLoop` against a real temp-dir
  project with a scripted in-process `MockProvider` (implements `LLMProvider` directly, no
  network) — covering the write→complete path, tool-result feedback into subsequent prompts,
  `TASK_BLOCKED`, max-iteration exhaustion, permission denial, and sandbox-escape refusal.
- **Manual end-to-end verification** during development used a small scripted HTTP server
  speaking real OpenAI-compatible SSE streaming (`/chat/completions`) to validate the streaming
  parser itself, since the in-process `MockProvider` bypasses HTTP/SSE entirely. That script
  isn't part of the automated suite (it's not deterministic infrastructure to keep in CI as-is)
  but the bug it caught — the streaming-response parser silently no-op'ing against a
  differently-shaped response — is exactly the kind of thing worth being aware of if you add a
  new provider: confirm your target server's actual `stream: true` response shape against
  `OpenAICompatibleProvider.consumeStream`.

Run a single file: `npx vitest run src/__tests__/permissions.test.ts`.

## Adding a provider

If it speaks OpenAI's chat-completions format (most local-model servers do), add an entry to
`DEFAULT_BASE_URLS` and the switch in `src/providers/registry.ts` — no new client code.

If it doesn't, implement `BaseProvider` (`src/providers/base.ts`) with your own `complete()`.

## Known gaps

Being upfront about what's scaffolded but not fully wired, so it's not a surprise:

- `agent.maxRetriesPerTask` is defined in config but not yet enforced as a per-task retry limit
  distinct from the overall `maxIterations` loop bound.
- `run_command` has no PTY, so fully interactive CLI wizards won't work well.
- Context selection is heuristic (keyword/path scoring + token budget), not embeddings-based —
  see [ARCHITECTURE.md](./ARCHITECTURE.md#context-management) for why, and how to extend it.
- Only tested live against a scripted OpenAI-compatible SSE server, not a live Ollama/vLLM/
  llama.cpp instance in this environment (no network access to install/run one here). The wire
  format is standard and the same client handles all of them, but if you hit provider-specific
  quirks, please file them — `consumeStream`/`messageToChunk` in `openaiCompatible.ts` is the
  place to adjust.
