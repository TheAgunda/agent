import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryManager } from '../memory/index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-memory-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MemoryManager', () => {
  it('persists and reloads entries by category', () => {
    const mem = new MemoryManager(tmpDir);
    mem.remember('convention', 'Use 2-space indentation');
    mem.remember('decision', 'Use PostgreSQL for persistence');

    const mem2 = new MemoryManager(tmpDir);
    const summary = mem2.summaryForPrompt();
    expect(summary).toContain('Use 2-space indentation');
    expect(summary).toContain('Use PostgreSQL for persistence');
  });

  it('writes a human-readable markdown file grouped by category', () => {
    const mem = new MemoryManager(tmpDir);
    mem.remember('issue', 'Flaky test in auth.spec.ts');
    const raw = mem.readAll();
    expect(raw).toContain('## Known Issues');
    expect(raw).toContain('Flaky test in auth.spec.ts');
  });

  it('reports not existing before any writes', () => {
    const mem = new MemoryManager(tmpDir);
    expect(mem.exists()).toBe(false);
    mem.remember('command', 'npm test');
    expect(mem.exists()).toBe(true);
  });
});
