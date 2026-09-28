import type { ChatMessage, CompletionChunk, CompletionRequest, LLMProvider, ToolCall } from '../types/index.js';

export interface ScriptedStep {
  text?: string;
  toolCalls?: ToolCall[];
}

/**
 * A deterministic in-process LLMProvider that plays back a fixed sequence of
 * responses, advancing one step per `complete()` call. Lets tests exercise the
 * agent loop / planner without any network dependency.
 */
export class MockProvider implements LLMProvider {
  readonly name = 'mock';
  readonly model = 'mock-model';
  private turn = 0;
  public readonly requests: CompletionRequest[] = [];

  constructor(private readonly script: ScriptedStep[]) {}

  async complete(request: CompletionRequest, onChunk?: (chunk: CompletionChunk) => void): Promise<CompletionChunk> {
    this.requests.push(request);
    const step = this.script[Math.min(this.turn, this.script.length - 1)];
    this.turn++;
    if (step.text) onChunk?.({ textDelta: step.text });
    const chunk: CompletionChunk = {
      textDelta: step.text ?? '',
      toolCalls: step.toolCalls,
      done: true,
      finishReason: step.toolCalls ? 'tool_calls' : 'stop',
    };
    onChunk?.(chunk);
    return chunk;
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true };
  }
}
