import fs from 'node:fs';
import path from 'node:path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { DEFAULT_CONFIG } from '../../config/schema.js';
import { loadConfig, writeProjectConfig, projectAgentDir } from '../../config/loader.js';
import { createProvider } from '../../providers/registry.js';
import { AgentLoop } from '../../agent/loop.js';
import { SessionStore } from '../../session/index.js';
import { createInteractiveConfirm, createAutoConfirm } from '../confirm.js';
import { banner, statusLine, successLine, errorLine, toolStartLine, toolEndLine, renderPlan, dim } from '../../ui/console.js';
import { buildProjectInfo } from '../../context/indexer.js';

export interface CommonOpts {
  yes?: boolean;
  permissions?: 'safe' | 'ask' | 'auto';
  model?: string;
  provider?: string;
}

export async function initCommand(cwd: string): Promise<void> {
  const agentDir = projectAgentDir(cwd);
  if (fs.existsSync(agentDir)) {
    console.log(errorLine(`.agent already exists at ${agentDir}. Edit .agent/config.yaml directly or delete it to re-init.`));
    return;
  }

  console.log(banner({ model: '(not configured yet)', provider: '(not configured yet)', project: path.basename(cwd) }));

  const answers = await inquirer.prompt<{
    provider: 'ollama' | 'llamacpp' | 'vllm' | 'openai-compatible' | 'openai';
    name: string;
    baseUrl: string;
    permMode: 'safe' | 'ask' | 'auto';
  }>([
    {
      type: 'list',
      name: 'provider',
      message: 'Model provider',
      choices: ['ollama', 'llamacpp', 'vllm', 'openai-compatible', 'openai'],
      default: 'ollama',
    },
    {
      type: 'input',
      name: 'name',
      message: 'Model name',
      default: (a: any) => (a.provider === 'openai' ? 'gpt-4o-mini' : 'qwen3:30b'),
    },
    {
      type: 'input',
      name: 'baseUrl',
      message: 'Base URL',
      default: (a: any) =>
        ({
          ollama: 'http://localhost:11434/v1',
          llamacpp: 'http://localhost:8080/v1',
          vllm: 'http://localhost:8000/v1',
          openai: 'https://api.openai.com/v1',
          'openai-compatible': 'http://localhost:8000/v1',
        })[a.provider as string],
    },
    {
      type: 'list',
      name: 'permMode',
      message: 'Default permission mode',
      choices: ['ask', 'auto', 'safe'],
      default: 'ask',
    },
  ]);

  const config = {
    ...DEFAULT_CONFIG,
    model: { ...DEFAULT_CONFIG.model, provider: answers.provider, name: answers.name, baseUrl: answers.baseUrl },
    permissions: { ...DEFAULT_CONFIG.permissions, mode: answers.permMode },
  };

  writeProjectConfig(cwd, config);
  fs.mkdirSync(path.join(agentDir, 'context'), { recursive: true });
  fs.mkdirSync(path.join(agentDir, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(agentDir, 'plans'), { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'memory.md'),
    '# Project Memory\n\n_Persistent notes the agent has learned about this project. Safe to hand-edit._\n',
    'utf-8'
  );

  const info = buildProjectInfo(cwd, config.ignore);
  console.log(successLine(`Initialized .agent/ in ${cwd}`));
  console.log(dim(`Detected: ${info.languages.join(', ') || 'unknown language'}${info.frameworks.length ? ` · ${info.frameworks.join(', ')}` : ''}`));
  console.log(dim(`Edit .agent/config.yaml any time, or run "agent config" to inspect it.`));
}

function resolveConfig(cwd: string, opts: CommonOpts) {
  const overrides: any = {};
  if (opts.model || opts.provider) {
    overrides.model = {};
    if (opts.model) overrides.model.name = opts.model;
    if (opts.provider) overrides.model.provider = opts.provider;
  }
  if (opts.permissions) overrides.permissions = { mode: opts.permissions };
  return loadConfig({ projectRoot: cwd, overrides });
}

export async function runCommand(cwd: string, task: string, opts: CommonOpts): Promise<void> {
  const config = resolveConfig(cwd, opts);
  const provider = createProvider(config.model);

  console.log(banner({ model: config.model.name, provider: config.model.provider, project: path.basename(cwd) }));

  const health = await provider.healthCheck();
  if (!health.ok) {
    console.log(errorLine(`Cannot reach model provider (${config.model.provider} @ ${config.model.baseUrl}): ${health.detail}`));
    console.log(dim('Start your local model server (e.g. `ollama serve`, or `ollama run qwen3:30b`) and try again.'));
    process.exitCode = 1;
    return;
  }

  const confirm = opts.yes || config.permissions.mode === 'auto' ? createAutoConfirm() : createInteractiveConfirm(!process.stdin.isTTY);

  const loop = new AgentLoop({
    projectRoot: cwd,
    config,
    provider,
    confirm,
    handlers: {
      onStatus: (m) => console.log(statusLine(m)),
      onIteration: () => {},
      onPlanUpdate: (plan) => console.log(`\n${renderPlan(plan)}\n`),
      onToolStart: (call) => console.log(toolStartLine(call)),
      onToolEnd: (call, result) => console.log(toolEndLine(call, result)),
      onAssistantText: (delta) => process.stdout.write(delta),
      onDone: () => console.log(''),
      onError: (err) => console.log(errorLine(err.message)),
    },
  });

  const result = await loop.run(task);
  console.log('');
  if (result.session.status === 'completed') {
    console.log(successLine('Task completed successfully.'));
  } else if (result.session.status === 'interrupted') {
    console.log(statusLine('Task paused/blocked. Run `agent resume` to continue.'));
  } else {
    console.log(errorLine('Task did not complete. See summary above; try `agent resume` or refine the request.'));
  }
}

export async function resumeCommand(cwd: string, opts: CommonOpts): Promise<void> {
  const config = resolveConfig(cwd, opts);
  const sessions = new SessionStore(cwd);
  const latest = sessions.latest();
  if (!latest) {
    console.log(errorLine('No previous session found to resume.'));
    return;
  }
  if (latest.status === 'completed') {
    console.log(statusLine(`Latest session already completed: "${latest.goal}"`));
    return;
  }
  console.log(statusLine(`Resuming session for: "${latest.goal}" (iteration ${latest.iterations})`));

  const provider = createProvider(config.model);
  const confirm = opts.yes || config.permissions.mode === 'auto' ? createAutoConfirm() : createInteractiveConfirm(!process.stdin.isTTY);

  const loop = new AgentLoop({
    projectRoot: cwd,
    config,
    provider,
    confirm,
    resumeSession: latest,
    handlers: {
      onStatus: (m) => console.log(statusLine(m)),
      onPlanUpdate: (plan) => console.log(`\n${renderPlan(plan)}\n`),
      onToolStart: (call) => console.log(toolStartLine(call)),
      onToolEnd: (call, result) => console.log(toolEndLine(call, result)),
      onAssistantText: (delta) => process.stdout.write(delta),
      onError: (err) => console.log(errorLine(err.message)),
    },
  });

  const result = await loop.run(latest.goal);
  console.log('');
  console.log(result.session.status === 'completed' ? successLine('Task completed successfully.') : statusLine(`Session status: ${result.session.status}`));
}

export async function chatCommand(cwd: string, opts: CommonOpts): Promise<void> {
  const config = resolveConfig(cwd, opts);
  const provider = createProvider(config.model);
  console.log(banner({ model: config.model.name, provider: config.model.provider, project: path.basename(cwd) }));
  console.log(dim('Interactive chat — type a request, or "exit" to quit.\n'));

  const confirm = opts.yes || config.permissions.mode === 'auto' ? createAutoConfirm() : createInteractiveConfirm(!process.stdin.isTTY);

  while (true) {
    const { message } = await inquirer.prompt<{ message: string }>([
      { type: 'input', name: 'message', message: chalk.cyan('you >') },
    ]);
    if (!message.trim() || ['exit', 'quit', ':q'].includes(message.trim().toLowerCase())) break;

    const loop = new AgentLoop({
      projectRoot: cwd,
      config,
      provider,
      confirm,
      handlers: {
        onStatus: (m) => console.log(statusLine(m)),
        onPlanUpdate: (plan) => console.log(`\n${renderPlan(plan)}\n`),
        onToolStart: (call) => console.log(toolStartLine(call)),
        onToolEnd: (call, result) => console.log(toolEndLine(call, result)),
        onAssistantText: (delta) => process.stdout.write(delta),
      },
    });
    await loop.run(message);
    console.log('');
  }
  console.log(dim('Goodbye.'));
}
