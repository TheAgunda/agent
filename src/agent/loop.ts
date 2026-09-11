import type {
  AgentEventHandlers,
  ChatMessage,
  LLMProvider,
  Plan,
  ToolCall,
  ToolDefinition,
} from '../types/index.js';
import type { AgentConfig } from '../config/schema.js';
import { ContextManager } from '../context/manager.js';
import { ToolRegistry } from '../tools/registry.js';
import { PermissionManager, type ConfirmFn } from '../permissions/index.js';
import { Planner } from '../planning/planner.js';
import { MemoryManager } from '../memory/index.js';
import { SessionStore, type SessionRecord } from '../session/index.js';
import { buildSystemPrompt } from './promptBuilder.js';

const UPDATE_TASK_STATUS_TOOL: ToolDefinition = {
  name: 'update_task_status',
  description: "Update the status of a task in the current plan. Use this to track your own progress.",
  parameters: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'The id of the task to update.' },
      status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'failed', 'skipped'] },
      notes: { type: 'string', description: 'Optional short note about the outcome.' },
    },
    required: ['taskId', 'status'],
  },
  riskLevel: 'read',
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
  private readonly memory: MemoryManager;
  private readonly sessions: SessionStore;
  private cancelled = false;

  constructor(private readonly options: AgentLoopOptions) {
    this.contextManager = new ContextManager({
      projectRoot: options.projectRoot,
      contextLimit: options.config.agent.contextLimit,
      ignore: options.config.ignore,
    });
    this.permissions = new PermissionManager(options.config.permissions, options.projectRoot);
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
    this.memory = new MemoryManager(options.projectRoot, options.config.memory.maxEntries);
    this.sessions = new SessionStore(options.projectRoot);
  }

  cancel(): void {
    this.cancelled = true;
  }

  async run(goal: string): Promise<{ session: SessionRecord; plan: Plan | null; summary: string }> {
    const { config, provider, confirm, handlers } = this.options;
    const session = this.options.resumeSession ?? this.sessions.create(goal);

    handlers?.onStatus?.('Analyzing project...');
    const initialContext = this.contextManager.buildContext(goal);
    handlers?.onStatus?.(`${initialContext.projectInfo.fileCount} files analyzed`);

    let plan: Plan | null = null;
    if (config.agent.planningEnabled) {
      handlers?.onStatus?.('Planning implementation...');
      try {
        plan = this.planner.loadLatest();
        if (!plan || plan.goal !== goal) {
          plan = await this.planner.createPlan(goal, provider, initialContext.summaryBlock);
        }
        session.planId = plan.id;
        handlers?.onPlanUpdate?.(plan);
        handlers?.onStatus?.(`${plan.tasks.length} tasks planned`);
      } catch (err) {
        handlers?.onStatus?.(`Planning failed, continuing without a formal plan: ${(err as Error).message}`);
      }
    }

    const messages: ChatMessage[] = session.messages.length > 0 ? session.messages : [{ role: 'user', content: goal }];

    const availableTools = [...this.toolRegistry.list(), UPDATE_TASK_STATUS_TOOL];
    let finalSummary = '';
    let iteration = session.iterations;

    while (iteration < config.agent.maxIterations && !this.cancelled) {
      iteration++;
      handlers?.onIteration?.(iteration, config.agent.maxIterations);
      session.iterations = iteration;

      const freshContext = this.contextManager.buildContext(goal);
      const planRendered = plan ? this.planner.renderChecklist(plan) : null;
      const systemPrompt = buildSystemPrompt({
        config,
        context: freshContext,
        memorySummary: config.memory.enabled ? this.memory.summaryForPrompt() : '',
        plan,
        planRendered,
      });

      const requestMessages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...messages];

      let assistantText = '';
      const completion = await provider.complete(
        { messages: requestMessages, tools: availableTools, temperature: config.model.temperature, stream: true },
        (chunk) => {
          if (chunk.textDelta) {
            assistantText += chunk.textDelta;
            handlers?.onAssistantText?.(chunk.textDelta);
          }
        }
      );

      const toolCalls = completion.toolCalls ?? [];
      const textContent = assistantText || completion.textDelta || '';

      messages.push({ role: 'assistant', content: textContent, toolCalls: toolCalls.length > 0 ? toolCalls : undefined });
      session.messages = messages;
      this.sessions.save(session);

      if (toolCalls.length === 0) {
        // No tool calls: this is either a completion signal, a blocked signal, or the
        // model needs a nudge. Either way, the turn ends here.
        finalSummary = textContent;
        if (/^TASK_COMPLETE:/i.test(textContent.trim())) {
          session.status = 'completed';
          session.summary = textContent;
          this.sessions.save(session);
          if (plan) this.markRemainingTasksDone(plan);
          handlers?.onDone?.(textContent);
          return { session, plan, summary: textContent };
        }
        if (/^TASK_BLOCKED:/i.test(textContent.trim())) {
          session.status = 'interrupted';
          session.summary = textContent;
          this.sessions.save(session);
          handlers?.onDone?.(textContent);
          return { session, plan, summary: textContent };
        }
        // Model stopped without a clear signal — nudge it once more rather than
        // silently looping forever on ambiguous output.
        messages.push({
          role: 'user',
          content:
            'Continue. If the task is fully done and verified, reply with "TASK_COMPLETE: <summary>" and no tool calls. If you are stuck, reply with "TASK_BLOCKED: <reason>". Otherwise keep working using tools.',
        });
        continue;
      }

      for (const call of toolCalls) {
        if (this.cancelled) break;
        handlers?.onToolStart?.(call);
        const result = await this.executeToolCall(call, plan, handlers);
        handlers?.onToolEnd?.(call, result.result);
        messages.push({
          role: 'tool',
          content: result.result.output,
          toolCallId: call.id,
          toolName: call.name,
        });
        this.recordTouchedFile(call);
      }
      session.messages = messages;
      this.sessions.save(session);
    }

    if (this.cancelled) {
      session.status = 'interrupted';
      this.sessions.save(session);
      return { session, plan, summary: 'Cancelled by user.' };
    }

    session.status = 'failed';
    session.summary = `Reached max iterations (${config.agent.maxIterations}) without a completion signal.`;
    this.sessions.save(session);
    handlers?.onError?.(new Error(session.summary));
    return { session, plan, summary: finalSummary || session.summary };
  }

  private recordTouchedFile(call: ToolCall): void {
    const p = call.arguments?.path;
    if (typeof p === 'string') this.contextManager.markTouched(p);
  }

  private async executeToolCall(
    call: ToolCall,
    plan: Plan | null,
    handlers?: AgentEventHandlers
  ): Promise<{ result: import('../types/index.js').ToolResult }> {
    if (call.name === 'update_task_status') {
      if (!plan) {
        return { result: { ok: false, output: 'No active plan to update.', error: 'no plan' } };
      }
      const { taskId, status, notes } = call.arguments as { taskId: string; status: string; notes?: string };
      const validStatuses = ['pending', 'in_progress', 'done', 'failed', 'skipped'];
      if (!validStatuses.includes(status)) {
        return { result: { ok: false, output: `Invalid status "${status}"`, error: 'invalid status' } };
      }
      this.planner.updateTaskStatus(plan, taskId, status as any, notes);
      handlers?.onPlanUpdate?.(plan);
      return { result: { ok: true, output: `Task ${taskId} marked ${status}.` } };
    }

    const result = await this.toolRegistry.run(call.name, call.arguments, this.options.confirm);

    // Cheap, high-signal facts worth remembering across sessions.
    if (this.options.config.memory.enabled) {
      if (call.name === 'run_command' && /install/i.test(String(call.arguments.command ?? '')) && result.ok) {
        this.memory.remember('command', `Ran: ${call.arguments.command}`);
      }
      if (call.name === 'git_commit' && result.ok) {
        this.memory.remember('result', `Committed: ${call.arguments.message}`);
      }
    }

    return { result };
  }

  private markRemainingTasksDone(plan: Plan): void {
    let changed = false;
    for (const t of plan.tasks) {
      if (t.status === 'pending' || t.status === 'in_progress') {
        t.status = 'done';
        changed = true;
      }
    }
    if (changed) this.planner.save(plan);
  }
}
