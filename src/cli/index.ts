#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand, runCommand, chatCommand, resumeCommand } from './commands/core.js';
import { planCommand, askCommand, modelsCommand, configCommand, contextCommand, statusCommand, historyCommand } from './commands/inspect.js';
import { ConfigError } from '../config/loader.js';

const program = new Command();

program
  .name('agent')
  .description('A CLI-based autonomous coding agent designed for local/open-source LLMs (Qwen3, Llama, etc.)')
  .version('0.1.0');

function commonFlags(cmd: Command): Command {
  return cmd
    .option('-y, --yes', 'Never prompt for confirmation (declines anything that would need it in ask mode)')
    .option('--permissions <mode>', 'Override permission mode: safe | ask | auto')
    .option('--model <name>', 'Override the configured model name')
    .option('--provider <name>', 'Override the configured provider');
}

program.command('init').description('Initialize agent configuration in the current project').action(async () => {
  await guard(() => initCommand(process.cwd()));
});

commonFlags(program.command('run <task>').description('Run a one-shot autonomous task')).action(async (task, opts) => {
  await guard(() => runCommand(process.cwd(), task, opts));
});

commonFlags(program.command('chat').description('Start an interactive chat session with the agent')).action(async (opts) => {
  await guard(() => chatCommand(process.cwd(), opts));
});

commonFlags(program.command('resume').description('Resume the most recent interrupted/incomplete session')).action(async (opts) => {
  await guard(() => resumeCommand(process.cwd(), opts));
});

commonFlags(program.command('plan <goal>').description('Generate (without executing) a task plan for a goal')).action(async (goal, opts) => {
  await guard(() => planCommand(process.cwd(), goal, opts));
});

commonFlags(program.command('ask <question>').description('Ask a read-only question about the codebase')).action(async (question, opts) => {
  await guard(() => askCommand(process.cwd(), question, opts));
});

commonFlags(program.command('models').description('Check model provider connectivity and list available models')).action(async (opts) => {
  await guard(() => modelsCommand(process.cwd(), opts));
});

commonFlags(program.command('config').description('Show the resolved configuration').argument('[action]', 'show | path', 'show')).action(
  async (action, opts) => {
    await guard(() => configCommand(process.cwd(), action, opts));
  }
);

commonFlags(program.command('context [query]').description('Preview which files would be selected as context for a query')).action(
  async (query, opts) => {
    await guard(() => contextCommand(process.cwd(), query ?? '', opts));
  }
);

commonFlags(program.command('status').description('Show project, model, and session status')).action(async (opts) => {
  await guard(() => statusCommand(process.cwd(), opts));
});

program
  .command('history')
  .description('Show recent sessions')
  .option('--limit <n>', 'Max sessions to show', '20')
  .action((opts) => {
    historyCommand(process.cwd(), Number(opts.limit) || 20);
  });

async function guard(fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(chalk.red(err.message));
      console.error(chalk.dim('Run `agent init` to create a valid configuration, or fix .agent/config.yaml.'));
    } else {
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
      if (err instanceof Error && err.stack && process.env.AGENT_DEBUG) console.error(chalk.dim(err.stack));
    }
    process.exitCode = 1;
  }
}

program.parseAsync(process.argv);
