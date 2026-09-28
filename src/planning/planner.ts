import { randomUUID } from 'node:crypto';
import type { LLMProvider, Plan, PlanTask } from '../types/index.js';
import { openDatabase, type DB } from '../db/index.js';

const PLANNING_SYSTEM_PROMPT = `You are a software project planner. Given a goal, break it into a concrete, ordered
checklist of concrete implementation tasks a coding agent can execute one at a time.

Rules:
- Return ONLY a JSON array of strings, each a single task description. No prose, no markdown fences.
- 4 to 12 tasks. Prefer fewer, well-scoped tasks over many trivial ones.
- Order tasks so dependencies come first (e.g. "design schema" before "implement API").
- Include validation tasks near the end (e.g. "run tests and fix failures", "update documentation") when relevant.
- Be specific to the stated goal and any provided project context — do not output generic boilerplate.`;

function parseTaskList(raw: string): string[] {
  const cleaned = raw.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.map(String).filter((s) => s.trim().length > 0);
  } catch {
    // fall through to line-based parsing
  }
  return cleaned
    .split('\n')
    .map((l) => l.replace(/^[-*\d.)\s\[\]xX]+/, '').trim())
    .filter((l) => l.length > 0);
}

interface PlanRow {
  id: string;
  goal: string;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  description: string;
  status: PlanTask['status'];
  notes: string | null;
}

const now = () => new Date().toISOString();

export class Planner {
  private readonly db: DB;

  constructor(projectRoot: string) {
    this.db = openDatabase(projectRoot);
  }

  async createPlan(goal: string, provider: LLMProvider, projectContextSummary: string): Promise<Plan> {
    const completion = await provider.complete({
      messages: [
        { role: 'system', content: PLANNING_SYSTEM_PROMPT },
        { role: 'user', content: `Project context:\n${projectContextSummary}\n\nGoal:\n${goal}` },
      ],
      temperature: 0.2,
      stream: false,
    });

    const descriptions = parseTaskList(completion.textDelta ?? '');
    const tasks: PlanTask[] = descriptions.map((description) => ({
      id: randomUUID(),
      description,
      status: 'pending',
    }));

    const ts = now();
    const plan: Plan = {
      id: randomUUID(),
      goal,
      createdAt: ts,
      updatedAt: ts,
      tasks: tasks.length > 0 ? tasks : [{ id: randomUUID(), description: goal, status: 'pending' }],
    };

    this.save(plan);
    return plan;
  }

  /** Upsert the plan and all of its tasks in one transaction. */
  save(plan: Plan): void {
    plan.updatedAt = now();
    const upsertPlan = this.db.prepare(
      `INSERT INTO plans (id, goal, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET goal = excluded.goal, updated_at = excluded.updated_at`
    );
    const upsertTask = this.db.prepare(
      `INSERT INTO plan_tasks (id, plan_id, position, description, status, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         position = excluded.position, description = excluded.description,
         status = excluded.status, notes = excluded.notes, updated_at = excluded.updated_at`
    );
    this.db.transaction(() => {
      upsertPlan.run(plan.id, plan.goal, plan.createdAt, plan.updatedAt);
      plan.tasks.forEach((t, i) => upsertTask.run(t.id, plan.id, i, t.description, t.status, t.notes ?? null, plan.updatedAt));
    })();
  }

  loadLatest(): Plan | null {
    const row = this.db.prepare('SELECT * FROM plans ORDER BY created_at DESC, rowid DESC LIMIT 1').get() as
      | PlanRow
      | undefined;
    return row ? this.hydrate(row) : null;
  }

  load(planId: string): Plan | null {
    const row = this.db.prepare('SELECT * FROM plans WHERE id = ?').get(planId) as PlanRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  private hydrate(row: PlanRow): Plan {
    const tasks = this.db
      .prepare('SELECT id, description, status, notes FROM plan_tasks WHERE plan_id = ? ORDER BY position')
      .all(row.id) as TaskRow[];
    return {
      id: row.id,
      goal: row.goal,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      tasks: tasks.map((t) => ({
        id: t.id,
        description: t.description,
        status: t.status,
        ...(t.notes ? { notes: t.notes } : {}),
      })),
    };
  }

  /**
   * Update one task with a single UPDATE statement. Returns the updated task, or null when no
   * task with that id exists in `plan` (callers must treat null as a failure, not a success).
   */
  updateTaskStatus(plan: Plan, taskId: string, status: PlanTask['status'], notes?: string): PlanTask | null {
    const task = plan.tasks.find((t) => t.id === taskId);
    if (!task) return null;
    const ts = now();
    const info = this.db
      .prepare(
        `UPDATE plan_tasks SET status = ?, notes = COALESCE(?, notes), updated_at = ?
          WHERE id = ? AND plan_id = ?`
      )
      .run(status, notes ?? null, ts, taskId, plan.id);
    if (info.changes === 0) return null;
    this.db.prepare('UPDATE plans SET updated_at = ? WHERE id = ?').run(ts, plan.id);
    task.status = status;
    if (notes) task.notes = notes;
    plan.updatedAt = ts;
    return task;
  }

  nextPendingTask(plan: Plan): PlanTask | undefined {
    return plan.tasks.find((t) => t.status === 'pending');
  }

  renderChecklist(plan: Plan): string {
    const marks: Record<PlanTask['status'], string> = {
      pending: '[ ]',
      in_progress: '[~]',
      done: '[x]',
      failed: '[!]',
      skipped: '[-]',
    };
    return plan.tasks.map((t) => `${marks[t.status]} (id: ${t.id}) ${t.description}`).join('\n');
  }
}
