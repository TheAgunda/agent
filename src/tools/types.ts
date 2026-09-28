import type { ToolDefinition, ToolResult } from '../types/index.js';

export interface ToolContext {
  projectRoot: string;
  /** Project-detected/configured commands (test/lint/format/...), used as defaults by testing tools. */
  commands?: { test?: string; lint?: string; format?: string; build?: string; install?: string };
}

export interface Tool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export function ok(output: string, data?: unknown): ToolResult {
  return { ok: true, output, data };
}

export function fail(output: string, error?: string, fatal = false): ToolResult {
  return { ok: false, output, error: error ?? output, fatal };
}
