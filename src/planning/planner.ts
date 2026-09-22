import { SQLiteDatabase } from "../storage/sqlite.js";
import { AgentRepository } from "../storage/repository.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { LLMProvider, Plan, PlanTask } from "../types/index.js";
import { projectAgentDir } from "../config/loader.js";

function plansDir(projectRoot: string): string {
  return path.join(projectAgentDir(projectRoot), "plans");
}

function planPath(projectRoot: string, planId: string): string {
  return path.join(plansDir(projectRoot), `${planId}.json`);
}

const PLANNING_SYSTEM_PROMPT = `You are a software project planner. Given a goal, break it into a concrete, ordered
checklist of concrete implementation tasks a coding agent can execute one at a time.

Rules:
- Return ONLY a JSON array of strings, each a single task description. No prose, no markdown fences.
- 4 to 12 tasks. Prefer fewer, well-scoped tasks over many trivial ones.
- Order tasks so dependencies come first (e.g. "design schema" before "implement API").
- Include validation tasks near the end (e.g. "run tests and fix failures", "update documentation") when relevant.
- Be specific to the stated goal and any provided project context — do not output generic boilerplate.`;

function parseTaskList(raw: string): string[] {
  const cleaned = raw
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed))
      return parsed.map(String).filter((s) => s.trim().length > 0);
  } catch {
    // fall through to line-based parsing
  }
  return cleaned
    .split("\n")
    .map((l) => l.replace(/^[-*\d.)\s\[\]xX]+/, "").trim())
    .filter((l) => l.length > 0);
}

export class Planner {
  private readonly database: SQLiteDatabase;
  private readonly repository: AgentRepository;
  private readonly projectId: string;
  constructor(private readonly projectRoot: string) {
    this.database = new SQLiteDatabase(projectRoot);
    this.repository = new AgentRepository(this.database.connection);
    this.projectId = this.ensureProject();
  }
  private ensureProject(): string {
    const existing = this.repository.getProjectByRoot(this.projectRoot);
    if (existing) {
      return existing.id;
    }
    const projectName = path.basename(this.projectRoot);
    console.log()
    return this.repository.createProject(projectName, this.projectRoot);
  }
  async createPlan(
    goal: string,
    provider: LLMProvider,
    projectContextSummary: string,
  ): Promise<Plan> {
    const completion = await provider.complete({
      messages: [
        { role: "system", content: PLANNING_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Project context:\n${projectContextSummary}\n\nGoal:\n${goal}`,
        },
      ],
      temperature: 0.2,
      stream: false,
    });

    const taskDescriptions = parseTaskList(completion.textDelta ?? "");
    const tasks: PlanTask[] = taskDescriptions.map((description) => ({
      id: randomUUID(),
      description,
      status: "pending",
    }));

    const plan: Plan = {
      id: randomUUID(),
      goal,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tasks:
        tasks.length > 0
          ? tasks
          : [{ id: randomUUID(), description: goal, status: "pending" }],
    };

    console.log(plan);
    this.save(plan);
    return plan;
  }

  save(plan: Plan): void {
    fs.mkdirSync(plansDir(this.projectRoot), { recursive: true });
    fs.writeFileSync(
      planPath(this.projectRoot, plan.id),
      JSON.stringify(plan, null, 2),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(plansDir(this.projectRoot), "latest.json"),
      JSON.stringify({ planId: plan.id }),
      "utf-8",
    );
  }

  loadLatest(): Plan | null {
    const latestPointer = path.join(plansDir(this.projectRoot), "latest.json");
    if (!fs.existsSync(latestPointer)) return null;
    try {
      const { planId } = JSON.parse(fs.readFileSync(latestPointer, "utf-8"));
      return this.load(planId);
    } catch {
      return null;
    }
  }

  load(planId: string): Plan | null {
    const p = planPath(this.projectRoot, planId);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as Plan;
  }

  updateTaskStatus(
    plan: Plan,
    taskId: string,
    status: PlanTask["status"],
    notes?: string,
  ): Plan {
    const task = plan.tasks.find((t) => t.id === taskId);
    if (task) {
      task.status = status;
      if (notes) task.notes = notes;
    }
    plan.updatedAt = new Date().toISOString();
    this.save(plan);
    return plan;
  }

  nextPendingTask(plan: Plan): PlanTask | undefined {
    return plan.tasks.find((t) => t.status === "pending");
  }

  renderChecklist(plan: Plan): string {
    const marks: Record<PlanTask["status"], string> = {
      pending: "[ ]",
      in_progress: "[~]",
      done: "[x]",
      failed: "[!]",
      skipped: "[-]",
    };
    return plan.tasks
      .map((t) => `${marks[t.status]} ${t.description}`)
      .join("\n");
  }
}
