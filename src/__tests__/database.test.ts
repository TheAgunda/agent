import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, closeDatabase, databasePath, SCHEMA_VERSION } from '../db/index.js';
import { SessionStore } from '../session/index.js';
import { MemoryManager } from '../memory/index.js';
import { Planner } from '../planning/planner.js';
import { AgentLoop } from '../agent/loop.js';
import { DEFAULT_CONFIG } from '../config/schema.js';
import { MockProvider } from './mockProvider.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-db-test-'));
});

afterEach(() => {
  closeDatabase(tmpDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('database', () => {
  it('creates .agent/agent.db and applies all migrations', () => {
    const db = openDatabase(tmpDir);
    expect(fs.existsSync(databasePath(tmpDir))).toBe(true);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (t) => t.name
    );
    for (const t of ['sessions', 'messages', 'tool_calls', 'plans', 'plan_tasks', 'memory_entries', 'tool_runs']) {
      expect(tables).toContain(t);
    }
  });

  it('is idempotent: reopening does not re-run migrations or lose data', () => {
    new MemoryManager(tmpDir).remember('issue', 'persisted');
    closeDatabase(tmpDir);
    expect(new MemoryManager(tmpDir).list()).toHaveLength(1);
  });

  it('enforces CHECK constraints (invalid status is rejected by the database)', () => {
    const db = openDatabase(tmpDir);
    expect(() =>
      db.prepare("INSERT INTO sessions (id, goal, status, created_at, updated_at) VALUES ('x','g','bogus','t','t')").run()
    ).toThrow();
  });
});

describe('SessionStore (SQL)', () => {
  it('round-trips messages including tool calls and tool results', () => {
    const store = new SessionStore(tmpDir);
    const s = store.create('goal');
    s.messages.push({ role: 'user', content: 'hi' });
    s.messages.push({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c1', name: 'write_file', arguments: { path: 'a.ts', content: 'x' } }],
    });
    s.messages.push({ role: 'tool', content: 'ok', toolCallId: 'c1', toolName: 'write_file' });
    s.iterations = 2;
    s.status = 'completed';
    s.summary = 'done';
    store.save(s);

    const loaded = store.load(s.id)!;
    expect(loaded.status).toBe('completed');
    expect(loaded.iterations).toBe(2);
    expect(loaded.summary).toBe('done');
    expect(loaded.messages).toEqual(s.messages);
  });

  it('appends only new messages on subsequent saves (no duplicates)', () => {
    const store = new SessionStore(tmpDir);
    const s = store.create('goal');
    s.messages.push({ role: 'user', content: 'one' });
    store.save(s);
    store.save(s);
    s.messages.push({ role: 'assistant', content: 'two' });
    store.save(s);
    expect(store.load(s.id)!.messages.map((m) => m.content)).toEqual(['one', 'two']);
  });

  it('latest() and list() return newest sessions first', () => {
    const store = new SessionStore(tmpDir);
    const a = store.create('first');
    const b = store.create('second');
    expect(store.latest()!.id).toBe(b.id);
    expect(store.list().map((x) => x.goal)).toEqual(['second', 'first']);
    expect(a.id).not.toBe(b.id);
  });

  it('logs tool runs to the audit table', () => {
    const store = new SessionStore(tmpDir);
    const s = store.create('goal');
    store.logToolRun({ sessionId: s.id, toolName: 'run_tests', arguments: {}, ok: false, output: 'boom', durationMs: 12 });
    const runs = store.listToolRuns(s.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ toolName: 'run_tests', ok: false, output: 'boom', durationMs: 12 });
  });
});

describe('Planner (SQL)', () => {
  it('persists task status changes to the plan_tasks table', async () => {
    const planner = new Planner(tmpDir);
    const plan = await planner.createPlan('g', new MockProvider([{ text: JSON.stringify(['A', 'B']) }]), 'ctx');
    planner.updateTaskStatus(plan, plan.tasks[1].id, 'done', 'finished');

    const reloaded = new Planner(tmpDir).load(plan.id)!;
    expect(reloaded.tasks.map((t) => t.status)).toEqual(['pending', 'done']);
    expect(reloaded.tasks[1].notes).toBe('finished');
    expect(reloaded.tasks.map((t) => t.description)).toEqual(['A', 'B']); // order preserved
  });

  it('does not touch another plan\'s tasks when given a foreign task id', async () => {
    const planner = new Planner(tmpDir);
    const p1 = await planner.createPlan('g1', new MockProvider([{ text: JSON.stringify(['A']) }]), 'ctx');
    const p2 = await planner.createPlan('g2', new MockProvider([{ text: JSON.stringify(['B']) }]), 'ctx');
    expect(planner.updateTaskStatus(p2, p1.tasks[0].id, 'done')).toBeNull();
    expect(planner.load(p1.id)!.tasks[0].status).toBe('pending');
  });
});

describe('MemoryManager (SQL)', () => {
  it('prunes the oldest entries per category beyond maxEntries', () => {
    const mem = new MemoryManager(tmpDir, 3);
    for (let i = 1; i <= 5; i++) mem.remember('issue', `issue ${i}`);
    mem.remember('decision', 'kept');
    expect(mem.list('issue').map((e) => e.text)).toEqual(['issue 3', 'issue 4', 'issue 5']);
    expect(mem.list('decision')).toHaveLength(1);
  });

  it('forget() deletes by id', () => {
    const mem = new MemoryManager(tmpDir);
    mem.remember('command', 'npm test');
    const id = mem.list()[0].id!;
    expect(mem.forget(id)).toBe(true);
    expect(mem.forget(id)).toBe(false);
    expect(mem.exists()).toBe(false);
  });
});

describe('AgentLoop persistence (SQL)', () => {
  const config = {
    ...DEFAULT_CONFIG,
    agent: { ...DEFAULT_CONFIG.agent, planningEnabled: false, maxIterations: 5 },
    permissions: { ...DEFAULT_CONFIG.permissions, mode: 'auto' as const },
  };

  it('stores the transcript and audits each tool execution', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    const provider = new MockProvider([
      { toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: 'a.txt' } }] },
      { text: 'TASK_COMPLETE: read it' },
    ]);
    const result = await new AgentLoop({ projectRoot: tmpDir, config, provider, confirm: async () => true }).run('read');

    const store = new SessionStore(tmpDir);
    const saved = store.load(result.session.id)!;
    expect(saved.status).toBe('completed');
    expect(saved.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    const runs = store.listToolRuns(result.session.id);
    expect(runs.map((r) => r.toolName)).toEqual(['read_file']);
    expect(runs[0].ok).toBe(true);
  });

  it('resumes an interrupted session from the database with its full history', async () => {
    const first = new MockProvider([{ text: 'TASK_BLOCKED: need input' }]);
    const r1 = await new AgentLoop({ projectRoot: tmpDir, config, provider: first, confirm: async () => true }).run('task');
    expect(r1.session.status).toBe('interrupted');

    const store = new SessionStore(tmpDir);
    const latest = store.latest()!;
    const second = new MockProvider([{ text: 'TASK_COMPLETE: finished' }]);
    const r2 = await new AgentLoop({
      projectRoot: tmpDir,
      config,
      provider: second,
      confirm: async () => true,
      resumeSession: latest,
    }).run('task');

    expect(r2.session.id).toBe(r1.session.id);
    // the resumed request carried the earlier assistant message from the DB
    const sent = second.requests[0].messages.map((m) => m.content);
    expect(sent.some((c) => c.includes('TASK_BLOCKED'))).toBe(true);
    expect(store.load(r1.session.id)!.messages.length).toBeGreaterThanOrEqual(2);
  });
});
