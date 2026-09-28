import { describe, it, expect } from 'vitest';
import { PermissionManager } from '../permissions/index.js';
import type { ToolDefinition } from '../types/index.js';
import { DEFAULT_CONFIG } from '../config/schema.js';

const def = (name: string, riskLevel: ToolDefinition['riskLevel']): ToolDefinition => ({
  name,
  description: '',
  parameters: { type: 'object', properties: {} },
  riskLevel,
});

describe('PermissionManager', () => {
  it('always allows reads without confirmation', () => {
    const pm = new PermissionManager(DEFAULT_CONFIG.permissions, '/project');
    const decision = pm.evaluate(def('read_file', 'read'), { path: 'a.ts' });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirmation).toBe(false);
  });

  it('blocks safe mode from performing writes', () => {
    const pm = new PermissionManager({ ...DEFAULT_CONFIG.permissions, mode: 'safe' }, '/project');
    const decision = pm.evaluate(def('write_file', 'write'), { path: 'a.ts' });
    expect(decision.allowed).toBe(false);
  });

  it('requires confirmation for writes in ask mode', () => {
    const pm = new PermissionManager({ ...DEFAULT_CONFIG.permissions, mode: 'ask' }, '/project');
    const decision = pm.evaluate(def('write_file', 'write'), { path: 'a.ts' });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirmation).toBe(true);
  });

  it('allows writes without confirmation in auto mode unless configured otherwise', () => {
    const pm = new PermissionManager({ ...DEFAULT_CONFIG.permissions, mode: 'auto' }, '/project');
    const decision = pm.evaluate(def('write_file', 'write'), { path: 'a.ts' });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirmation).toBe(false);
  });

  it('always requires confirmation for destructive ops even in auto mode', () => {
    const pm = new PermissionManager({ ...DEFAULT_CONFIG.permissions, mode: 'auto' }, '/project');
    const decision = pm.evaluate(def('delete_file', 'destructive'), { path: 'a.ts' });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirmation).toBe(true);
  });

  it('blocks path traversal outside the project root', () => {
    const pm = new PermissionManager({ ...DEFAULT_CONFIG.permissions, mode: 'auto' }, '/project');
    const decision = pm.evaluate(def('write_file', 'write'), { path: '../outside.txt' });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/outside the project root/);
  });

  it('permits edits outside the project when explicitly allowed', () => {
    const pm = new PermissionManager(
      { ...DEFAULT_CONFIG.permissions, mode: 'auto', allowEditOutsideProject: true },
      '/project'
    );
    const decision = pm.evaluate(def('write_file', 'write'), { path: '../outside.txt' });
    expect(decision.allowed).toBe(true);
  });

  it('blocks dangerous shell commands regardless of mode', () => {
    const pm = new PermissionManager({ ...DEFAULT_CONFIG.permissions, mode: 'auto' }, '/project');
    const decision = pm.evaluate(def('run_command', 'exec'), { command: 'sudo rm -rf /' });
    expect(decision.allowed).toBe(false);
  });

  it('authorize() resolves via the provided confirm callback when confirmation is required', async () => {
    const pm = new PermissionManager({ ...DEFAULT_CONFIG.permissions, mode: 'ask' }, '/project');
    const allowed = await pm.authorize(def('write_file', 'write'), { path: 'a.ts' }, async () => true);
    expect(allowed.allowed).toBe(true);

    const denied = await pm.authorize(def('write_file', 'write'), { path: 'a.ts' }, async () => false);
    expect(denied.allowed).toBe(false);
  });
});
