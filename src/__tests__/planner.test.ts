import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Planner } from '../planning/planner.js';
import { MockProvider } from './mockProvider.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-planner-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Planner', () => {
  it('parses a JSON array response into ordered pending tasks', async () => {
    const provider = new MockProvider([{ text: JSON.stringify(['Set up project', 'Add auth', 'Write tests']) }]);
    const planner = new Planner(tmpDir);
    const plan = await planner.createPlan('Build an app', provider, 'context');
    expect(plan.tasks).toHaveLength(3);
    expect(plan.tasks[0].description).toBe('Set up project');
    expect(plan.tasks.every((t) => t.status === 'pending')).toBe(true);
  });

  it('falls back to line-based parsing for non-JSON responses', async () => {
    const provider = new MockProvider([{ text: '1. Do the first thing\n2. Do the second thing' }]);
    const planner = new Planner(tmpDir);
    const plan = await planner.createPlan('Goal', provider, 'context');
    expect(plan.tasks.map((t) => t.description)).toEqual(['Do the first thing', 'Do the second thing']);
  });

  it('persists plans to disk and reloads the latest one', async () => {
    const provider = new MockProvider([{ text: JSON.stringify(['Task A']) }]);
    const planner = new Planner(tmpDir);
    const plan = await planner.createPlan('Goal', provider, 'context');

    const planner2 = new Planner(tmpDir);
    const loaded = planner2.loadLatest();
    expect(loaded?.id).toBe(plan.id);
  });

  it('updates task status and finds the next pending task', async () => {
    const provider = new MockProvider([{ text: JSON.stringify(['A', 'B']) }]);
    const planner = new Planner(tmpDir);
    const plan = await planner.createPlan('Goal', provider, 'context');
    const first = planner.nextPendingTask(plan)!;
    planner.updateTaskStatus(plan, first.id, 'done');
    const next = planner.nextPendingTask(plan);
    expect(next?.description).toBe('B');
  });

  it('renders a readable checklist', async () => {
    const provider = new MockProvider([{ text: JSON.stringify(['A']) }]);
    const planner = new Planner(tmpDir);
    const plan = await planner.createPlan('Goal', provider, 'context');
    expect(planner.renderChecklist(plan)).toContain('[ ] A');
  });
});
