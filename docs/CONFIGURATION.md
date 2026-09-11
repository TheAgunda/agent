# Configuration

Configuration is layered, each level overriding the previous (later wins):

1. Built-in defaults (`src/config/schema.ts`)
2. Global config: `~/.agent/config.yaml`
3. Project config: `<project>/.agent/config.yaml` (written by `agent init`)
4. Environment variables
5. CLI flags (`--model`, `--provider`, `--permissions`) for the current invocation only

Run `agent config` to see the fully resolved configuration, or `agent config path` for the
project config file's path.

## Full schema

```yaml
model:
  provider: ollama            # ollama | llamacpp | vllm | openai-compatible | openai
  name: qwen3:30b
  baseUrl: http://localhost:11434/v1   # defaulted per-provider if omitted
  apiKey: ""                  # only needed for hosted providers
  temperature: 0.2
  maxTokens: 4096
  contextWindow: 100000

agent:
  maxIterations: 50           # hard stop on the tool-calling loop per `run`/`resume`
  autoTest: true               # advisory: mentioned in the system prompt, doesn't force test runs
  autoFix: true
  autoLint: false
  contextLimit: 100000         # token budget for file context selection
  maxRetriesPerTask: 3
  planningEnabled: true        # create/track a plan before executing

permissions:
  mode: ask                    # safe | ask | auto
  allowEditOutsideProject: false
  blockedCommands:             # substring match, always enforced regardless of mode
    - "rm -rf /"
    - "sudo rm"
    - "curl | sh"
    # ...
  requireConfirmationFor:      # tool names that always confirm even in auto mode
    - install_dependency
    - delete_file
    - run_command
    - git_commit

commands:                      # override auto-detected project commands
  test: "npm test"
  lint: "npm run lint"
  format: "npm run format"
  build: "npm run build"
  install: "npm install"

memory:
  enabled: true
  maxEntries: 200

ignore:                        # additional ignore patterns, merged with .gitignore + built-in defaults
  - "*.generated.ts"

systemPrompt: ""                # optional full override of the base system prompt
```

## Environment variable overrides

- `AGENT_MODEL_PROVIDER`, `AGENT_MODEL_NAME`, `AGENT_MODEL_BASE_URL`, `AGENT_MODEL_API_KEY`
- `OPENAI_API_KEY` (used automatically when `provider: openai` and no `model.apiKey` is set)
- `AGENT_PERMISSIONS_MODE`
- `AGENT_DEBUG=1` — print stack traces on CLI errors

## Project vs global config

Global config (`~/.agent/config.yaml`) is a good place for your preferred model/provider so every
project picks it up by default. Project config (`<project>/.agent/config.yaml`, created by `agent
init`) is for per-project overrides — e.g. a stricter `permissions.mode`, or explicit
`commands.test` when auto-detection guesses wrong.

## Auto-detected project commands

If `commands.test`/`lint`/`format` aren't set, the agent detects them from `package.json` scripts
(Node projects) or common Python conventions (`pytest`, `ruff`). Run `agent status` to see what
was detected; set the relevant `commands.*` key to override.
