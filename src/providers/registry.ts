import type { LLMProvider } from "../types/index.js";
import type { ModelConfig } from "../config/schema.js";
import { OpenAICompatibleProvider } from "./openaiCompatible.js";
const DEFAULT_BASE_URLS: Record<string, string> = {
  ollama: "http://localhost:11434/v1",
  llamacpp: "http://localhost:8080/v1",
  vllm: "http://localhost:8000/v1",
  openai: "https://api.openai.com/v1",
  "openai-compatible": "http://localhost:8000/v1",
};

export function createProvider(config: ModelConfig): LLMProvider {
  const resolved: ModelConfig = {
    ...config,
    baseUrl:
      config.baseUrl ??
      DEFAULT_BASE_URLS[config.provider] ??
      DEFAULT_BASE_URLS["openai-compatible"],
  };

  switch (config.provider) {
    case "ollama":
    case "llamacpp":
    case "vllm":
    case "openai":
    case "openai-compatible":
      return new OpenAICompatibleProvider(resolved, config.provider);
    default:
      throw new Error(`Unknown model provider: ${config.provider}`);
  }
}
