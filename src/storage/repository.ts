import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  CreatePlanInput,
  CreateSessionInput,
  Message,
  Plan,
  PlanStatus,
  PlanTask,
  PlanTaskStatus,
  Session,
} from "./types";
interface PlanRow {
  id: string;
  project_id: string;
  session_id: string | null;
  goal: string;
  status: PlanStatus;
  created_at: string;
  updated_at: string;
}
interface TaskRow {
  id: string;
  plan_id: string;
  task_index: number;
  description: string;
  status: PlanTaskStatus;
  notes: string | null;
  started_at: string | null;
  completed_at: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}
interface SessionRow {
  id: string;
  project_id: string;
  title: string | null;
  status: "active" | "completed" | "archived";
  provider: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}
interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  provider: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  metadata: string | null;
  created_at: string;
}
export class AgentRepository {
  constructor(private readonly db: Database.Database) {}
  createProject(name: string, rootPath: string): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        ` INSERT INTO projects ( id, name, root_path, created_at, updated_at ) VALUES (?, ?, ?, ?, ?) `,
      )
      .run(id, name, rootPath, now, now);
    return id;
  }
  getProjectByRoot(
    rootPath: string,
  ): { id: string; name: string; rootPath: string } | null {
    const row = this.db
      .prepare(` SELECT * FROM projects WHERE root_path = ? `)
      .get(rootPath) as
      | { id: string; name: string; root_path: string }
      | undefined;
    if (!row) {
      return null;
    }
    return { id: row.id, name: row.name, rootPath: row.root_path };
  }
  createSession(input: CreateSessionInput): Session {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        ` INSERT INTO sessions ( id, project_id, title, status, provider, model, created_at, updated_at ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?) `,
      )
      .run(
        id,
        input.projectId,
        input.title ?? null,
        input.provider ?? null,
        input.model ?? null,
        now,
        now,
      );
    return {
      id,
      projectId: input.projectId,
      title: input.title,
      status: "active",
      provider: input.provider,
      model: input.model,
      createdAt: now,
      updatedAt: now,
    };
  }
  getSession(sessionId: string): Session | null {
    const row = this.db
      .prepare(` SELECT * FROM sessions WHERE id = ? `)
      .get(sessionId) as SessionRow | undefined;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title ?? undefined,
      status: row.status,
      provider: row.provider ?? undefined,
      model: row.model ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  addMessage(input: {
    sessionId: string;
    role: string;
    content: string;
    provider?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    metadata?: Record<string, unknown>;
  }): Message {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        ` INSERT INTO messages ( id, session_id, role, content, provider, model, input_tokens, output_tokens, metadata, created_at ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) `,
      )
      .run(
        id,
        input.sessionId,
        input.role,
        input.content,
        input.provider ?? null,
        input.model ?? null,
        input.inputTokens ?? null,
        input.outputTokens ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        now,
      );
    this.touchSession(input.sessionId);
    return {
      id,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      provider: input.provider,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      metadata: input.metadata,
      createdAt: now,
    };
  }
  getMessages(sessionId: string): Message[] {
    const rows = this.db
      .prepare(
        ` SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC `,
      )
      .all(sessionId) as MessageRow[];
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      provider: row.provider ?? undefined,
      model: row.model ?? undefined,
      inputTokens: row.input_tokens ?? undefined,
      outputTokens: row.output_tokens ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
    }));
  }
  private touchSession(sessionId: string): void {
    this.db
      .prepare(` UPDATE sessions SET updated_at = ? WHERE id = ? `)
      .run(new Date().toISOString(), sessionId);
  }
  createPlan(input: CreatePlanInput): Plan {
    const planId = randomUUID();
    const now = new Date().toISOString();
    const tasks: PlanTask[] = input.tasks.map((description, index) => ({
      id: randomUUID(),
      planId,
      index,
      description,
      status: "pending",
      attempts: 0,
      dependencies: [],
      createdAt: now,
      updatedAt: now,
    }));
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          ` INSERT INTO plans ( id, project_id, session_id, goal, status, created_at, updated_at ) VALUES (?, ?, ?, ?, 'active', ?, ?) `,
        )
        .run(
          planId,
          input.projectId,
          input.sessionId ?? null,
          input.goal,
          now,
          now,
        );
      const insertTask = this.db.prepare(
        ` INSERT INTO tasks ( id, plan_id, task_index, description, status, attempts, created_at, updated_at ) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?) `,
      );
      for (const task of tasks) {
        insertTask.run(task.id, planId, task.index, task.description, now, now);
      }
      this.addEvent(
        input.projectId,
        input.sessionId??null,
        planId,
        null,
        "plan.created",
        { goal: input.goal, taskCount: tasks.length },
      );
    });
    transaction();
    return {
      id: planId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      goal: input.goal,
      status: "active",
      createdAt: now,
      updatedAt: now,
      tasks,
    };
  }
  getPlan(planId: string): Plan | null {
    const row = this.db
      .prepare(` SELECT * FROM plans WHERE id = ? `)
      .get(planId) as PlanRow | undefined;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      projectId: row.project_id,
      sessionId: row.session_id ?? undefined,
      goal: row.goal,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      tasks: this.getTasks(row.id),
    };
  }
  getLatestPlan(projectId: string): Plan | null {
    const row = this.db
      .prepare(
        ` SELECT * FROM plans WHERE project_id = ? AND status != 'archived' ORDER BY created_at DESC LIMIT 1 `,
      )
      .get(projectId) as PlanRow | undefined;
    if (!row) {
      return null;
    }
    return this.getPlan(row.id);
  }
  getTasks(planId: string): PlanTask[] {
    const rows = this.db
      .prepare(
        ` SELECT * FROM tasks WHERE plan_id = ? ORDER BY task_index ASC `,
      )
      .all(planId) as TaskRow[];
    return rows.map((row) => this.mapTask(row));
  }
  getTask(taskId: string): PlanTask | null {
    const row = this.db
      .prepare(` SELECT * FROM tasks WHERE id = ? `)
      .get(taskId) as TaskRow | undefined;
    if (!row) {
      return null;
    }
    return this.mapTask(row);
  }
  updateTaskStatus(
    taskId: string,
    status: PlanTaskStatus,
    notes?: string,
  ): PlanTask | null {
    const task = this.getTask(taskId);
    if (!task) {
      return null;
    }
    const now = new Date().toISOString();
    let startedAt = task.startedAt ?? null;
    let completedAt = task.completedAt ?? null;
    if (status === "in_progress" && !startedAt) {
      startedAt = now;
    }
    if (status === "done" || status === "failed" || status === "skipped") {
      completedAt = now;
    }
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          ` UPDATE tasks SET status = ?, notes = COALESCE(?, notes), started_at = ?, completed_at = ?, attempts = CASE WHEN ? = 'in_progress' THEN attempts + 1 ELSE attempts END, updated_at = ? WHERE id = ? `,
        )
        .run(
          status,
          notes ?? null,
          startedAt,
          completedAt,
          status,
          now,
          taskId,
        );
      this.db
        .prepare(` UPDATE plans SET updated_at = ? WHERE id = ? `)
        .run(now, task.planId);
      const updatedTask = this.getTask(taskId);
      this.addEvent(
        this.getPlanProjectId(task.planId),
        this.getPlanSessionId(task.planId),
        task.planId,
        taskId,
        `task.${status}`,
        { status, notes },
      );
      this.updatePlanStatus(task.planId);
      return updatedTask;
    });
    return transaction();
  }
  nextPendingTask(planId: string): PlanTask | undefined {
    const row = this.db
      .prepare(
        ` SELECT * FROM tasks WHERE plan_id = ? AND status = 'pending' AND NOT EXISTS ( SELECT 1 FROM task_dependencies td INNER JOIN tasks dependency ON dependency.id = td.depends_on_task_id WHERE td.task_id = tasks.id AND dependency.status != 'done' ) ORDER BY task_index ASC LIMIT 1 `,
      )
      .get(planId) as TaskRow | undefined;
    if (!row) {
      return undefined;
    }
    return this.mapTask(row);
  }
  addTaskDependency(taskId: string, dependsOnTaskId: string): void {
    if (taskId === dependsOnTaskId) {
      throw new Error("A task cannot depend on itself.");
    }
    this.db
      .prepare(
        ` INSERT OR IGNORE INTO task_dependencies ( task_id, depends_on_task_id ) VALUES (?, ?) `,
      )
      .run(taskId, dependsOnTaskId);
  }
  getTaskDependencies(taskId: string): string[] {
    const rows = this.db
      .prepare(
        ` SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ? `,
      )
      .all(taskId) as { depends_on_task_id: string }[];
    return rows.map((row) => row.depends_on_task_id);
  }
  private mapTask(row: TaskRow): PlanTask {
    return {
      id: row.id,
      planId: row.plan_id,
      index: row.task_index,
      description: row.description,
      status: row.status,
      notes: row.notes ?? undefined,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      attempts: row.attempts,
      dependencies: this.getTaskDependencies(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  private updatePlanStatus(planId: string): void {
    const counts = this.db
      .prepare(
        ` SELECT COUNT(*) AS total, SUM( CASE WHEN status = 'done' THEN 1 ELSE 0 END ) AS done, SUM( CASE WHEN status = 'failed' THEN 1 ELSE 0 END ) AS failed FROM tasks WHERE plan_id = ? `,
      )
      .get(planId) as { total: number; done: number; failed: number };
    if (counts.total > 0 && counts.done === counts.total) {
      this.db
        .prepare(
          ` UPDATE plans SET status = 'completed', updated_at = ? WHERE id = ? `,
        )
        .run(new Date().toISOString(), planId);
      return;
    }
    if (counts.failed > 0) {
      this.db
        .prepare(
          ` UPDATE plans SET status = 'failed', updated_at = ? WHERE id = ? `,
        )
        .run(new Date().toISOString(), planId);
    }
  }
  createTaskRun(taskId: string, command?: string): string {
    const id = randomUUID();
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        ` INSERT INTO task_runs ( id, task_id, attempt, status, command, started_at ) VALUES (?, ?, ?, 'running', ?, ?) `,
      )
      .run(id, taskId, task.attempts + 1, command ?? null, now);
    return id;
  }
  completeTaskRun(
    runId: string,
    status: "completed" | "failed",
    output?: string,
    error?: string,
  ): void {
    this.db
      .prepare(
        ` UPDATE task_runs SET status = ?, output = ?, error = ?, completed_at = ? WHERE id = ? `,
      )
      .run(
        status,
        output ?? null,
        error ?? null,
        new Date().toISOString(),
        runId,
      );
  }
  createToolCall(input: {
    sessionId?: string;
    taskId?: string;
    toolName: string;
    input?: unknown;
  }): string {
    const id = randomUUID();
    this.db
      .prepare(
        ` INSERT INTO tool_calls ( id, session_id, task_id, tool_name, input, status, started_at ) VALUES (?, ?, ?, ?, ?, 'running', ?) `,
      )
      .run(
        id,
        input.sessionId ?? null,
        input.taskId ?? null,
        input.toolName,
        input.input !== undefined ? JSON.stringify(input.input) : null,
        new Date().toISOString(),
      );
    return id;
  }
  completeToolCall(
    id: string,
    status: "completed" | "failed",
    output?: unknown,
    error?: string,
  ): void {
    this.db
      .prepare(
        ` UPDATE tool_calls SET status = ?, output = ?, error = ?, completed_at = ? WHERE id = ? `,
      )
      .run(
        status,
        output !== undefined ? JSON.stringify(output) : null,
        error ?? null,
        new Date().toISOString(),
        id,
      );
  }
  addContextItem(input: {
    projectId: string;
    sessionId?: string;
    type: string;
    content: string;
    source?: string;
    metadata?: Record<string, unknown>;
  }): string {
    const id = randomUUID();
    this.db
      .prepare(
        ` INSERT INTO context_items ( id, project_id, session_id, type, content, source, metadata, created_at ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) `,
      )
      .run(
        id,
        input.projectId,
        input.sessionId ?? null,
        input.type,
        input.content,
        input.source ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        new Date().toISOString(),
      );
    return id;
  }
  addEvent(
    projectId: string,
    sessionId: string | null,
    planId: string | null,
    taskId: string | null,
    eventType: string,
    payload?: unknown,
  ): void {
    this.db
      .prepare(
        ` INSERT INTO agent_events ( project_id, session_id, plan_id, task_id, event_type, payload, created_at ) VALUES (?, ?, ?, ?, ?, ?, ?) `,
      )
      .run(
        projectId,
        sessionId,
        planId,
        taskId,
        eventType,
        payload !== undefined ? JSON.stringify(payload) : null,
        new Date().toISOString(),
      );
  }
  private getPlanProjectId(planId: string): string {
    const row = this.db
      .prepare(` SELECT project_id FROM plans WHERE id = ? `)
      .get(planId) as { project_id: string } | undefined;
    if (!row) {
      throw new Error(`Plan not found: ${planId}`);
    }
    return row.project_id;
  }
  private getPlanSessionId(planId: string): string | null {
    const row = this.db
      .prepare(` SELECT session_id FROM plans WHERE id = ? `)
      .get(planId) as { session_id: string | null } | undefined;
    return row?.session_id ?? null;
  }
}
