import chalk from 'chalk';
import type { Plan, ToolCall, ToolResult } from '../types/index.js';

export function banner(opts: { model: string; project: string; provider: string }): string {
  const lines = [
    'AI Coding Agent',
    `Model: ${opts.model} (${opts.provider})`,
    `Project: ${opts.project}`,
  ];
  const width = Math.max(...lines.map((l) => l.length)) + 2;
  const top = `╭${'─'.repeat(width)}╮`;
  const bottom = `╰${'─'.repeat(width)}╯`;
  const body = lines.map((l) => `│ ${l.padEnd(width - 1)}│`).join('\n');
  return chalk.cyan([top, body, bottom].join('\n'));
}

export function statusLine(message: string): string {
  return chalk.blue(`▸ ${message}`);
}

export function successLine(message: string): string {
  return chalk.green(`✓ ${message}`);
}

export function errorLine(message: string): string {
  return chalk.red(`✗ ${message}`);
}

export function dim(message: string): string {
  return chalk.dim(message);
}

export function toolStartLine(call: ToolCall): string {
  const argsPreview = summarizeArgs(call.arguments);
  return chalk.magenta(`  ├─ ${call.name}${argsPreview ? chalk.dim(` ${argsPreview}`) : ''}`);
}

export function toolEndLine(call: ToolCall, result: ToolResult): string {
  const icon = result.ok ? chalk.green('✓') : chalk.red('✗');
  const firstLine = result.output.split('\n')[0]?.slice(0, 100) ?? '';
  return `  ${icon} ${call.name} ${chalk.dim(firstLine)}`;
}

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args).slice(0, 2);
  return entries
    .map(([k, v]) => `${k}=${typeof v === 'string' ? truncate(v, 50) : JSON.stringify(v)}`)
    .join(' ');
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function renderPlan(plan: Plan): string {
  const marks: Record<string, string> = {
    pending: chalk.dim('[ ]'),
    in_progress: chalk.yellow('[~]'),
    done: chalk.green('[x]'),
    failed: chalk.red('[!]'),
    skipped: chalk.dim('[-]'),
  };
  const header = chalk.bold(`Plan: ${plan.goal}`);
  const lines = plan.tasks.map((t) => `${marks[t.status] ?? '[ ]'} ${t.description}`);
  return [header, ...lines].join('\n');
}
