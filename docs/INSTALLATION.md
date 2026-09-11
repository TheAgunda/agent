# Installation & Model Setup

## Requirements

- Node.js >= 18
- A model backend: [Ollama](https://ollama.com), [llama.cpp](https://github.com/ggml-org/llama.cpp)'s
  `llama-server`, [vLLM](https://github.com/vllm-project/vllm), or any OpenAI-compatible endpoint.

## Install the CLI

```bash
git clone <this repo>
cd agent
npm install
npm run build
npm link              # optional: exposes the global `agent` command
```

Without `npm link`, run it as `node /path/to/agent/dist/cli/index.js ...`, or `npm run dev -- ...`
during development (uses `tsx`, no build step needed).

## Setting up Qwen3 30B (recommended local model)

### Via Ollama (simplest)

```bash
ollama pull qwen3:30b
ollama serve                     # starts the API on http://localhost:11434
```

Ollama exposes an OpenAI-compatible surface at `http://localhost:11434/v1` — this is the default
`baseUrl` for `provider: ollama`, so no extra configuration is needed beyond `agent init`.

Hardware note: qwen3:30b is a large model. If you're VRAM/RAM constrained, Ollama also serves
quantized tags (e.g. `qwen3:30b-q4_K_M`) — use whichever tag fits your machine as `model.name`.

### Via vLLM (best throughput, needs a GPU)

```bash
pip install vllm
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen3-30B-A3B \
  --port 8000
```

Configure:

```yaml
model:
  provider: vllm
  name: Qwen/Qwen3-30B-A3B
  baseUrl: http://localhost:8000/v1
```

### Via llama.cpp (CPU-friendly, GGUF quantized)

```bash
# build llama-server, then:
./llama-server -m /path/to/qwen3-30b.Q4_K_M.gguf --port 8080
```

Configure:

```yaml
model:
  provider: llamacpp
  name: qwen3-30b          # served model name is often ignored by llama-server, but keep it for logging
  baseUrl: http://localhost:8080/v1
```

## Using a hosted model instead

```yaml
model:
  provider: openai
  name: gpt-4o-mini
```

```bash
export OPENAI_API_KEY=sk-...
```

Any other OpenAI-compatible host (Together, Fireworks, OpenRouter, a company-internal proxy, ...)
works via `provider: openai-compatible` with the appropriate `baseUrl` and `apiKey`.

## First run

```bash
cd your-project
agent init          # writes .agent/config.yaml
agent status         # confirms the model endpoint is reachable and shows detected project info
agent run "..."
```

If `agent status` reports the model as unreachable, see
[TROUBLESHOOTING.md](./TROUBLESHOOTING.md#model-provider-unreachable).
