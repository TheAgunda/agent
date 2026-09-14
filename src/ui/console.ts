import chalk from "chalk";

// import type { Plan, ToolCall, ToolResult } from "../types/index.js";

export function banner(opts: {
  model: string;
  project: string;
  provider: string;
}): string {
  const lines = [
    "AI Coding Agent",
    `Model: ${opts.model} (${opts.provider})`,
    `Project: ${opts.project}`,
  ];
  const width = Math.max(...lines.map((l) => l.length)) + 2;
  const top = `╭${"─".repeat(width)}╮`;
  const bottom = `╰${"─".repeat(width)}╯`;
  const body = lines.map((l) => `│ ${l.padEnd(width - 1)}│`).join("\n");
  return chalk.cyan([top, body, bottom].join("\n"));
}

export function errorLine(message: string): string {
  return chalk.red(`✗ ${message}`);
}

export function successLine(message: string): string {
  return chalk.green(`✓ ${message}`);
}

export function dim(message: string): string {
  return chalk.dim(message);
}
