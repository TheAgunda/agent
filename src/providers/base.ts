import type { LLMProvider } from "../types/index.js";
import type { ModelConfig } from "../config/schema.js";

export class ProviderError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export abstract class BaseProvider implements LLMProvider {
  abstract readonly name: string;
  readonly model: string;
  protected readonly config: ModelConfig;

  constructor(config: ModelConfig) {
    this.config = config;
    this.model = config.name;
  }

  abstract complete(
    request: import("../types/index.js").CompletionRequest,
    onChunk?: (chunk: import("../types/index.js").CompletionChunk) => void,
  ): Promise<import("../types/index.js").CompletionChunk>;

  abstract healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}
