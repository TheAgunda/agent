export type PlanStatus =
  | "active"
  | "completed"
  | "failed"
  | "cancelled"
  | "archived";
export type PlanTaskStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "failed"
  | "skipped";
export interface CreatePlanInput {
  projectId: string;
  sessionId?: string;
  goal: string;
  tasks: string[];
}
export interface PlanTask {
  id: string;
  planId: string;
  index: number;
  description: string;
  status: PlanTaskStatus;
  notes?: string;
  startedAt?: string;
  completedAt?: string;
  attempts: number;
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
}
export interface Plan {
  id: string;
  projectId: string;
  sessionId?: string;
  goal: string;
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
  tasks: PlanTask[];
}
export interface CreateSessionInput {
  projectId: string;
  title?: string;
  provider?: string;
  model?: string;
}
export interface Session {
  id: string;
  projectId: string;
  title?: string;
  status: "active" | "completed" | "archived";
  provider?: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
}
export interface Message {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
