import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentLoop } from '../agent/loop.js';
import { DEFAULT_CONFIG } from '../config/schema.js';
import { MockProvider } from './mockProvider.js';
import { invalidateFileListCache } from '../context/indexer.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-loop-test-'));
  fs.writeFileSync(path.join(tmpDir, 'index.js'), "console.log('hello');\n");
  invalidateFileListCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<typeof DEFAULT_CONFIG> = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    agent: { ...DEFAULT_CONFIG.agent, planningEnabled: false, maxIterations: 5, ...(overrides.agent ?? {}) },
    permissions: { ...DEFAULT_CONFIG.permissions, mode: 'auto' as const, ...(overrides.permissions ?? {}) },
  };
}

describe('AgentLoop', () => {
  it('executes a write_file tool call then completes on TASK_COMPLETE', async () => {
    const provider = new MockProvider([
      {
        toolCalls: [
          { id: 'c1', name: 'write_file', arguments: { path: 'new.js', content: 'export const x = 1;' } },
        ],
      },
      { text: 'TASK_COMPLETE: created new.js' },
    ]);
    const loop = new AgentLoop({
      projectRoot: tmpDir,
      config: makeConfig(),
      provider,
      confirm: async () => true,
    });
    const result = await loop.run('create a file');
    expect(result.session.status).toBe('completed');
    expect(fs.existsSync(path.join(tmpDir, 'new.js'))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'new.js'), 'utf-8')).toBe('export const x = 1;');
  });

  it('feeds tool results back to the model as tool messages', async () => {
    const provider = new MockProvider([
      { toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: 'index.js' } }] },
      { text: 'TASK_COMPLETE: read the file' },
    ]);
    const loop = new AgentLoop({ projectRoot: tmpDir, config: makeConfig(), provider, confirm: async () => true });
    await loop.run('read the file');
    const secondRequest = provider.requests[1];
    const toolMsg = secondRequest.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain("console.log('hello');");
  });

  it('stops at TASK_BLOCKED and marks the session interrupted', async () => {
    const provider = new MockProvider([{ text: 'TASK_BLOCKED: need credentials' }]);
    const loop = new AgentLoop({ projectRoot: tmpDir, config: makeConfig(), provider, confirm: async () => true });
    const result = await loop.run('deploy to prod');
    expect(result.session.status).toBe('interrupted');
  });

  it('marks the session failed after exhausting max iterations without a completion signal', async () => {
    const provider = new MockProvider([{ text: 'still thinking...' }]);
    const loop = new AgentLoop({
      projectRoot: tmpDir,
      config: makeConfig({ agent: { ...DEFAULT_CONFIG.agent, planningEnabled: false, maxIterations: 3 } }),
      provider,
      confirm: async () => true,
    });
    const result = await loop.run('vague task');
    expect(result.session.status).toBe('failed');
    expect(result.session.iterations).toBe(3);
  });

  it('denies a destructive tool call when the user declines confirmation', async () => {
    fs.writeFileSync(path.join(tmpDir, 'important.js'), 'keep me');
    const provider = new MockProvider([
      { toolCalls: [{ id: 'c1', name: 'delete_file', arguments: { path: 'important.js' } }] },
      { text: 'TASK_COMPLETE: done' },
    ]);
    const loop = new AgentLoop({
      projectRoot: tmpDir,
      config: makeConfig(),
      provider,
      confirm: async () => false,
    });
    await loop.run('delete the important file');
    expect(fs.existsSync(path.join(tmpDir, 'important.js'))).toBe(true);
  });

  it('refuses to write outside the project root', async () => {
    const provider = new MockProvider([
      { toolCalls: [{ id: 'c1', name: 'write_file', arguments: { path: '../escape.js', content: 'x' } }] },
      { text: 'TASK_COMPLETE: done' },
    ]);
    const loop = new AgentLoop({ projectRoot: tmpDir, config: makeConfig(), provider, confirm: async () => true });
    await loop.run('escape the sandbox');
    expect(fs.existsSync(path.join(path.dirname(tmpDir), 'escape.js'))).toBe(false);
  });

  it('creates a plan when planning is enabled and marks tasks done on completion', async () => {
    let capturedTaskId = '';
    const loop = new AgentLoop({
      projectRoot: tmpDir,
      config: makeConfig({ agent: { ...DEFAULT_CONFIG.agent, planningEnabled: true, maxIterations: 5 } }),
      provider: new MockProvider([{ text: JSON.stringify(['Write the file']) }, { text: 'TASK_COMPLETE: done' }]),
      confirm: async () => true,
      handlers: {
        onPlanUpdate: (plan) => {
          capturedTaskId = plan.tasks[0]?.id ?? '';
        },
      },
    });
    const result = await loop.run('do a thing');
    expect(capturedTaskId).not.toBe('');
    expect(result.plan?.tasks[0].status).toBe('done');
  });
});
