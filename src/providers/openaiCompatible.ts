import { BaseProvider, ProviderError } from './base.js';
import type {
  ChatMessage,
  CompletionChunk,
  CompletionRequest,
  ToolCall,
  ToolDefinition,
} from '../types/index.js';
import type { ModelConfig } from '../config/schema.js';

interface OAIToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

interface OAIMessage {
  role: string;
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
}

function toOAIMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: m.content,
      };
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

function toOAITools(tools?: ToolDefinition[]): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Talks to any server implementing the OpenAI `/chat/completions` API surface.
 * This covers Ollama (`/v1` compat), vLLM, llama.cpp's `llama-server`, OpenAI itself,
 * and any other "OpenAI-compatible" endpoint.
 */
export class OpenAICompatibleProvider extends BaseProvider {
  readonly name: string;
  private readonly baseUrl: string;

  constructor(config: ModelConfig, displayName = 'openai-compatible') {
    super(config);
    this.name = displayName;
    this.baseUrl = (config.baseUrl ?? 'http://localhost:11434/v1').replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    return headers;
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers() });
      if (!res.ok) {
        return { ok: false, detail: `HTTP ${res.status} from ${this.baseUrl}/models` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async complete(
    request: CompletionRequest,
    onChunk?: (chunk: CompletionChunk) => void
  ): Promise<CompletionChunk> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: toOAIMessages(request.messages),
      temperature: request.temperature ?? this.config.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? this.config.maxTokens ?? 4096,
      stream: request.stream ?? true,
    };
    const tools = toOAITools(request.tools);
    if (tools) body.tools = tools;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ProviderError(
        `Could not reach model provider at ${this.baseUrl}. Is it running? (${
          err instanceof Error ? err.message : String(err)
        })`,
        err
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderError(`Provider returned HTTP ${res.status}: ${text.slice(0, 500)}`);
    }

    if (!body.stream) {
      const json = (await res.json()) as {
        choices: { message: OAIMessage; finish_reason: string }[];
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
      const choice = json.choices?.[0];
      const chunk = messageToChunk(choice?.message, choice?.finish_reason, json.usage);
      onChunk?.(chunk);
      return chunk;
    }

    return this.consumeStream(res, onChunk);
  }

  private async consumeStream(
    res: Response,
    onChunk?: (chunk: CompletionChunk) => void
  ): Promise<CompletionChunk> {
    if (!res.body) throw new ProviderError('Provider returned an empty streaming body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedText = '';
    const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: CompletionChunk['finishReason'] = 'stop';
    let usage: CompletionChunk['usage'];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        const delta = parsed.choices?.[0]?.delta;
        const fr = parsed.choices?.[0]?.finish_reason;
        if (parsed.usage) usage = mapUsage(parsed.usage);
        if (fr) finishReason = mapFinishReason(fr);
        if (delta?.content) {
          accumulatedText += delta.content;
          onChunk?.({ textDelta: delta.content });
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls as OAIToolCallDelta[]) {
            const existing = toolCallBuffers.get(tc.index) ?? { id: '', name: '', args: '' };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments) existing.args += tc.function.arguments;
            toolCallBuffers.set(tc.index, existing);
          }
        }
      }
    }

    const toolCalls: ToolCall[] = [...toolCallBuffers.values()]
      .filter((tc) => tc.name)
      .map((tc) => ({
        id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        name: tc.name,
        arguments: safeParseJSON(tc.args),
      }));

    const finalChunk: CompletionChunk = {
      done: true,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : finishReason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
    };
    onChunk?.(finalChunk);
    return { ...finalChunk, textDelta: accumulatedText };
  }
}

function safeParseJSON(text: string): Record<string, unknown> {
  if (!text || !text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

function mapFinishReason(fr: string): CompletionChunk['finishReason'] {
  if (fr === 'tool_calls') return 'tool_calls';
  if (fr === 'length') return 'length';
  if (fr === 'stop') return 'stop';
  return 'stop';
}

function mapUsage(u: any): CompletionChunk['usage'] {
  return {
    promptTokens: u.prompt_tokens,
    completionTokens: u.completion_tokens,
    totalTokens: u.total_tokens,
  };
}

function messageToChunk(
  message: OAIMessage | undefined,
  finishReason: string | undefined,
  usage: any
): CompletionChunk {
  const toolCalls: ToolCall[] | undefined = message?.tool_calls?.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: safeParseJSON(tc.function.arguments),
  }));
  return {
    textDelta: message?.content ?? '',
    toolCalls,
    done: true,
    finishReason: toolCalls && toolCalls.length > 0 ? 'tool_calls' : mapFinishReason(finishReason ?? 'stop'),
    usage: usage ? mapUsage(usage) : undefined,
  };
}
