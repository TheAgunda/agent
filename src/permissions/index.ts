import path from 'node:path';
import type { PermissionsConfig } from '../config/schema.js';
import type { ToolDefinition } from '../types/index.js';

export type ConfirmFn = (message: string, detail?: string) => Promise<boolean>;

export interface PermissionDecision {
  allowed: boolean;
  reason: string;
  requiresConfirmation: boolean;
}

/**
 * Central gatekeeper for anything the agent wants to do to the filesystem or shell.
 * Nothing in the tool layer executes without going through here first.
 */
export class PermissionManager {
  constructor(
    private readonly config: PermissionsConfig,
    private readonly projectRoot: string
  ) {}

  /** Static policy check — does not prompt, just says whether this needs asking / is blocked outright. */
  evaluate(tool: ToolDefinition, args: Record<string, unknown>): PermissionDecision {
    // 1. Path containment check for anything path-based.
    const targetPath = typeof args.path === 'string' ? args.path : undefined;
    if (targetPath && tool.riskLevel !== 'read' && !this.config.allowEditOutsideProject) {
      const resolved = path.resolve(this.projectRoot, targetPath);
      if (!isInside(this.projectRoot, resolved)) {
        return {
          allowed: false,
          reason: `Refusing to modify "${targetPath}": it resolves outside the project root (${this.projectRoot}). Set permissions.allowEditOutsideProject: true to allow this.`,
          requiresConfirmation: false,
        };
      }
    }

    // 2. Shell command blocklist — always enforced regardless of mode.
    if (tool.name === 'run_command') {
      const command = String(args.command ?? '');
      const blocked = this.config.blockedCommands.find((pattern) => commandMatches(command, pattern));
      if (blocked) {
        return {
          allowed: false,
          reason: `Command matches a blocked pattern ("${blocked}") and cannot be run under any permission mode.`,
          requiresConfirmation: false,
        };
      }
    }

    // 3. Read operations are always allowed.
    if (tool.riskLevel === 'read') {
      return { allowed: true, reason: 'read-only operation', requiresConfirmation: false };
    }

    // 4. Mode-based policy for write/exec/destructive operations.
    if (this.config.mode === 'safe') {
      return {
        allowed: false,
        reason: `permissions.mode is "safe": ${tool.name} (${tool.riskLevel}) is not permitted. Switch to "ask" or "auto" to allow it.`,
        requiresConfirmation: false,
      };
    }

    if (tool.riskLevel === 'destructive') {
      // Destructive actions always require confirmation, even in auto mode.
      return { allowed: true, reason: 'destructive operation requires confirmation', requiresConfirmation: true };
    }

    if (this.config.mode === 'auto') {
      const alwaysConfirm = this.config.requireConfirmationFor.includes(tool.name);
      return {
        allowed: true,
        reason: alwaysConfirm ? 'configured to always confirm' : 'auto mode',
        requiresConfirmation: alwaysConfirm,
      };
    }

    // ask mode
    return { allowed: true, reason: 'ask mode', requiresConfirmation: true };
  }

  async authorize(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    confirm: ConfirmFn
  ): Promise<{ allowed: boolean; reason: string }> {
    const decision = this.evaluate(tool, args);
    if (!decision.allowed) return { allowed: false, reason: decision.reason };
    if (!decision.requiresConfirmation) return { allowed: true, reason: decision.reason };

    const summary = summarizeCall(tool.name, args);
    const confirmed = await confirm(`Allow ${tool.name}?`, summary);
    return {
      allowed: confirmed,
      reason: confirmed ? 'user confirmed' : 'user declined',
    };
  }
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function commandMatches(command: string, pattern: string): boolean {
  return command.toLowerCase().includes(pattern.toLowerCase());
}

function summarizeCall(name: string, args: Record<string, unknown>): string {
  const entries = Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? truncate(v, 120) : JSON.stringify(v)}`)
    .join(', ');
  return `${name}(${entries})`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
