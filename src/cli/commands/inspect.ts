import path from 'node:path';
import yaml from 'js-yaml';
import { loadConfig } from '../../config/loader.js';
import { createProvider } from '../../providers/registry.js';
import { buildProjectInfo } from '../../context/indexer.js';
import { ContextManager } from '../../context/manager.js';
import { Planner } from '../../planning/planner.js';
import { SessionStore } from '../../session/index.js';
import { ToolRegistry } from '../../tools/registry.js';
import { PermissionManager } from '../../permissions/index.js';
import { createAutoConfirm } from '../confirm.js';
import { statusLine, successLine, errorLine, dim, renderPlan } from '../../ui/console.js';
import type { ChatMessage } from '../../types/index.js';
import type { CommonOpts } from './core.js';

function resolveConfig(cwd: string, opts: CommonOpts) {
  const overrides: any = {};
  if (opts.model || opts.provider) {
    overrides.model = {};
    if (opts.model) overrides.model.name = opts.model;
    if (opts.provider) overrides.model.provider = opts.provider;
  }
  return loadConfig({ projectRoot: cwd, overrides });
}

export async function planCommand(cwd: string, goal: string, opts: CommonOpts): Promise<void> {
  const config = resolveConfig(cwd, opts);
  const provider = createProvider(config.model);
  const health = await provider.healthCheck();
  if (!health.ok) {
    console.log(errorLine(`Cannot reach model provider: ${health.detail}`));
    process.exitCode = 1;
    return;
  }
  console.log(statusLine('Analyzing project and drafting a plan...'));
  const contextManager = new ContextManager({ projectRoot: cwd, contextLimit: config.agent.contextLimit, ignore: config.ignore });
  const context = contextManager.buildContext(goal);
  const planner = new Planner(cwd);
  const plan = await planner.createPlan(goal, provider, context.summaryBlock);
  console.log('');
  console.log(renderPlan(plan));
  console.log('');
  console.log(dim(`Saved to .agent/plans/${plan.id}.json — run "agent run \\"${goal}\\"" to execute it.`));
}

export async function askCommand(cwd: string, question: string, opts: CommonOpts): Promise<void> {
  const config = resolveConfig(cwd, opts);
  const provider = createProvider(config.model);
  const health = await provider.healthCheck();
  if (!health.ok) {
    console.log(errorLine(`Cannot reach model provider: ${health.detail}`));
    process.exitCode = 1;
    return;
  }

  const contextManager = new ContextManager({ projectRoot: cwd, contextLimit: config.agent.contextLimit, ignore: config.ignore });
  const permissions = new PermissionManager({ ...config.permissions, mode: 'safe' }, cwd);
  const detected = contextManager.getProjectInfo();
  const toolRegistry = new ToolRegistry(permissions, {
    projectRoot: cwd,
    commands: {
      test: config.commands.test ?? detected.testCommand,
      lint: config.commands.lint ?? detected.lintCommand,
      format: config.commands.format ?? detected.formatCommand,
    },
  });
  const readOnlyTools = toolRegistry.list().filter((t) => t.riskLevel === 'read');
  const confirm = createAutoConfirm();

  const context = contextManager.buildContext(question);
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a read-only codebase assistant. Answer the user's question about this project using the
provided context and the read-only tools available (read_file, list_directory, search_files, git_status, git_diff,
git_log). You cannot and must not modify anything. Be concise and cite specific files/lines where relevant.\n\n${context.summaryBlock}\n\n${context.fileContentBlock}`,
    },
    { role: 'user', content: question },
  ];

  for (let i = 0; i < 6; i++) {
    let text = '';
    const completion = await provider.complete(
      { messages, tools: readOnlyTools, stream: true, temperature: 0.2 },
      (chunk) => {
        if (chunk.textDelta) {
          text += chunk.textDelta;
          process.stdout.write(chunk.textDelta);
        }
      }
    );
    const toolCalls = completion.toolCalls ?? [];
    messages.push({ role: 'assistant', content: text, toolCalls: toolCalls.length ? toolCalls : undefined });
    if (toolCalls.length === 0) break;
    for (const call of toolCalls) {
      const result = await toolRegistry.run(call.name, call.arguments, confirm);
      messages.push({ role: 'tool', content: result.output, toolCallId: call.id, toolName: call.name });
    }
  }
  console.log('');
}

export async function modelsCommand(cwd: string, opts: CommonOpts): Promise<void> {
  const config = resolveConfig(cwd, opts);
  const provider = createProvider(config.model);
  console.log(statusLine(`Checking ${config.model.provider} @ ${config.model.baseUrl} ...`));
  const health = await provider.healthCheck();
  if (health.ok) {
    console.log(successLine(`Connected. Configured model: ${config.model.name}`));
  } else {
    console.log(errorLine(`Not reachable: ${health.detail}`));
  }
  try {
    const res = await fetch(`${config.model.baseUrl}/models`, {
      headers: config.model.apiKey ? { Authorization: `Bearer ${config.model.apiKey}` } : undefined,
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: { id: string }[] };
      const ids = json.data?.map((m) => m.id) ?? [];
      if (ids.length) {
        console.log(dim('Available models on this endpoint:'));
        for (const id of ids) console.log(`  - ${id}${id === config.model.name ? '  (configured)' : ''}`);
      }
    }
  } catch {
    // best-effort only
  }
}

export function configCommand(cwd: string, action: 'show' | 'path', opts: CommonOpts): void {
  const config = resolveConfig(cwd, opts);
  if (action === 'path') {
    console.log(path.join(cwd, '.agent', 'config.yaml'));
    return;
  }
  console.log(yaml.dump(config, { lineWidth: 100 }));
}

export function contextCommand(cwd: string, query: string, opts: CommonOpts): void {
  const config = resolveConfig(cwd, opts);
  const contextManager = new ContextManager({ projectRoot: cwd, contextLimit: config.agent.contextLimit, ignore: config.ignore });
  const context = contextManager.buildContext(query || 'general overview');
  console.log(context.summaryBlock);
  console.log('');
  console.log(dim(`Selected ${context.includedFiles.length} files (~${context.estimatedTokens} tokens) for query: "${query}"`));
  for (const f of context.includedFiles) console.log(`  - ${f}`);
}

export async function statusCommand(cwd: string, opts: CommonOpts): Promise<void> {
  const config = resolveConfig(cwd, opts);
  const info = buildProjectInfo(cwd, config.ignore);
  console.log(dim('Project'));
  console.log(`  root: ${info.root}`);
  console.log(`  languages: ${info.languages.join(', ') || 'unknown'}`);
  console.log(`  frameworks: ${info.frameworks.join(', ') || 'none detected'}`);
  console.log(`  files: ${info.fileCount}`);
  console.log(`  git: ${info.hasGit ? `yes (${info.gitBranch})` : 'no'}`);
  console.log('');
  console.log(dim('Model'));
  const provider = createProvider(config.model);
  const health = await provider.healthCheck();
  console.log(`  provider: ${config.model.provider}`);
  console.log(`  model: ${config.model.name}`);
  console.log(`  endpoint: ${config.model.baseUrl}`);
  console.log(`  reachable: ${health.ok ? 'yes' : `no (${health.detail})`}`);
  console.log('');
  console.log(dim('Permissions'));
  console.log(`  mode: ${config.permissions.mode}`);
  console.log('');
  const sessions = new SessionStore(cwd);
  const latest = sessions.latest();
  console.log(dim('Latest session'));
  if (latest) {
    console.log(`  goal: ${latest.goal}`);
    console.log(`  status: ${latest.status}`);
    console.log(`  iterations: ${latest.iterations}`);
  } else {
    console.log('  none yet');
  }
  const planner = new Planner(cwd);
  const plan = planner.loadLatest();
  if (plan) {
    console.log('');
    console.log(dim('Latest plan'));
    console.log(renderPlan(plan));
  }
}

export function historyCommand(cwd: string, limit: number): void {
  const sessions = new SessionStore(cwd);
  const list = sessions.list(limit);
  if (list.length === 0) {
    console.log(dim('No sessions yet.'));
    return;
  }
  for (const s of list) {
    console.log(`${s.updatedAt.slice(0, 19)}  [${s.status.padEnd(11)}]  ${s.goal}`);
  }
}
