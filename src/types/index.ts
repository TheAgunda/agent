/**
 * Core shared types for the agent.
 */

export type PermissionMode = 'safe' | 'ask' | 'auto';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present on assistant messages that request tool execution. */
  toolCalls?: ToolCall[];
  /** Present on tool messages: the id of the ToolCall this responds to. */
  toolCallId?: string;
  /** Present on tool messages: the name of the tool that was invoked. */
  toolName?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON-schema-like parameter description passed to the model. */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Category used by the permission system to decide how risky the tool is. */
  riskLevel: 'read' | 'write' | 'exec' | 'destructive';
}

export interface ToolResult {
  ok: boolean;
  /** Human/model readable summary of what happened. */
  output: string;
  /** Optional structured data for programmatic use (e.g. file diffs). */
  data?: unknown;
  error?: string;
  /** Whether this makes it safe to keep looping (used by error recovery heuristics). */
  fatal?: boolean;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface CompletionChunk {
  /** Incremental text delta, if any. */
  textDelta?: string;
  /** Fully materialized tool calls, emitted once complete (providers rarely stream tool-call args). */
  toolCalls?: ToolCall[];
  /** Set on the final chunk. */
  done?: boolean;
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  /** Perform a (possibly streaming) completion, yielding chunks. */
  complete(request: CompletionRequest, onChunk?: (chunk: CompletionChunk) => void): Promise<CompletionChunk>;
  /** Cheap connectivity/capability check used by `agent status` / `agent models`. */
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}

export interface FileContextEntry {
  path: string;
  relevance: number;
  reason: string;
}

export interface ProjectInfo {
  root: string;
  languages: string[];
  frameworks: string[];
  packageManagers: string[];
  fileCount: number;
  hasGit: boolean;
  gitBranch?: string;
  testCommand?: string;
  lintCommand?: string;
  formatCommand?: string;
}

export interface PlanTask {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
  notes?: string;
}

export interface Plan {
  id: string;
  goal: string;
  createdAt: string;
  updatedAt: string;
  tasks: PlanTask[];
}

export interface AgentEventHandlers {
  onStatus?: (message: string) => void;
  onToolStart?: (call: ToolCall) => void;
  onToolEnd?: (call: ToolCall, result: ToolResult) => void;
  onAssistantText?: (delta: string) => void;
  onIteration?: (n: number, max: number) => void;
  onPlanUpdate?: (plan: Plan) => void;
  onDone?: (summary: string) => void;
  onError?: (error: Error) => void;
}
