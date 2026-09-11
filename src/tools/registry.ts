import type { ToolDefinition, ToolResult } from '../types/index.js';
import type { Tool, ToolContext } from './types.js';
import { filesystemTools } from './filesystem.js';
import { shellTools } from './shell.js';
import { gitTools } from './git.js';
import { testingTools } from './testing.js';
import { PermissionManager, type ConfirmFn } from '../permissions/index.js';
import { invalidateFileListCache } from '../context/indexer.js';

const MUTATING_TOOLS = new Set(['write_file', 'edit_file', 'delete_file', 'install_dependency', 'run_command']);

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(
    private readonly permissions: PermissionManager,
    private readonly ctx: ToolContext
  ) {
    for (const tool of [...filesystemTools, ...shellTools, ...gitTools, ...testingTools]) {
      this.tools.set(tool.definition.name, tool);
    }
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async run(name: string, args: Record<string, unknown>, confirm: ConfirmFn): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, output: `Unknown tool: ${name}`, error: `Unknown tool: ${name}` };
    }

    const authz = await this.permissions.authorize(tool.definition, args, confirm);
    if (!authz.allowed) {
      return {
        ok: false,
        output: `Permission denied for ${name}: ${authz.reason}`,
        error: authz.reason,
      };
    }

    try {
      const result = await tool.execute(args, this.ctx);
      if (MUTATING_TOOLS.has(name) && result.ok) {
        invalidateFileListCache();
      }
      return result;
    } catch (err) {
      return {
        ok: false,
        output: `Tool ${name} threw an error: ${(err as Error).message}`,
        error: (err as Error).message,
      };
    }
  }
}
