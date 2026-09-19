import type {
  AgentEventHandlers,
  ChatMessage,
  LLMProvider,
  Plan,
  ToolCall,
  ToolDefinition,
} from "../types/index.js";
import { AgentConfig } from "../config/schema.js";
import { ConfirmFn } from "../permissions/index.js";
import { SessionRecord } from "../session/index.js";
import { ContextManager } from "../context/manager.js";
import { PermissionManager } from "../permissions/index.js";
import { ToolRegistry } from "../tools/registry.js";
import { Planner } from "../planning/planner.js";
const UPDATE_TASK_STATUS_TOOL: ToolDefinition = {
  name: "update_task_status",
  description:
    "Update the status of a task in the current plan. Use this to track your own progress.",
  parameters: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "The id of the task to update." },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "done", "failed", "skipped"],
      },
      notes: {
        type: "string",
        description: "Optional short note about the out`come.",
      },
    },
    required: ["taskId", "status"],
  },
  riskLevel: "read",
};

export interface AgentLoopOptions {
  projectRoot: string;
  config: AgentConfig;
  provider: LLMProvider;
  confirm: ConfirmFn;
  handlers?: AgentEventHandlers;
  resumeSession?: SessionRecord;
}

export class AgentLoop {
  private readonly contextManager: ContextManager;
  private readonly permissions: PermissionManager;
  private readonly toolRegistry: ToolRegistry;
  private readonly planner: Planner;
  //   private readonly memory: MemoryManager;
  //   private readonly sessions: SessionStore;
  private cancelled = false;
  constructor(private readonly options: AgentLoopOptions) {
    this.contextManager = new ContextManager({
      projectRoot: options.projectRoot,
      contextLimit: options.config.agent.contextLimit,
      ignore: options.config.ignore,
    });
    this.permissions = new PermissionManager(
      options.config.permissions,
      options.projectRoot,
    );
    const detected = this.contextManager.getProjectInfo();
    this.toolRegistry = new ToolRegistry(this.permissions, {
      projectRoot: options.projectRoot,
      commands: {
        test: options.config.commands.test ?? detected.testCommand,
        lint: options.config.commands.lint ?? detected.lintCommand,
        format: options.config.commands.format ?? detected.formatCommand,
        build: options.config.commands.build,
        install: options.config.commands.install,
      },
    });
    this.planner = new Planner(options.projectRoot);
    // this.memory = new MemoryManager(options.projectRoot, options.config.memory.maxEntries);
    // this.sessions = new SessionStore(options.projectRoot);
  }

  async run(goal: string) {
    //   :   Promise<{ session: SessionRecord; plan: Plan | null; summary: string }>
    const { config, provider, confirm, handlers } = this.options;
    // const session = this.options.resumeSession ?? this.sessions.create(goal);

    handlers?.onStatus?.("Analyzing project...");
    const initialContext = this.contextManager.buildContext(goal);
    handlers?.onStatus?.(
      `${initialContext.projectInfo.fileCount} files analyzed`,
    );

    let plan: Plan | null = null;
    if (config.agent.planningEnabled) {
      handlers?.onStatus?.("Planning implementation...");
      try {
        plan = this.planner.loadLatest();
        if (!plan || plan.goal !== goal) {
          plan = await this.planner.createPlan(
            goal,
            provider,
            initialContext.summaryBlock,
          );
        }
        // session.planId = plan.id;
        handlers?.onPlanUpdate?.(plan);
        handlers?.onStatus?.(`${plan.tasks.length} tasks planned`);
        handlers?.onStatus?.("=======================================");
      } catch (err) {
        handlers?.onStatus?.(
          `Planning failed, continuing without a formal plan: ${(err as Error).message}`,
        );
      }
    }
  }
}
