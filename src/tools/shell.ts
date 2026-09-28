import { spawn } from 'node:child_process';
import type { Tool, ToolContext } from './types.js';
import { ok, fail } from './types.js';

export interface RunCommandOptions {
  timeoutMs?: number;
}

export function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs = 120_000
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      stderr += `\n${err.message}`;
      resolve({ code: -1, stdout, stderr, timedOut });
    });
  });
}

const MAX_OUTPUT_CHARS = 8000;

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  const half = MAX_OUTPUT_CHARS / 2;
  return `${text.slice(0, half)}\n… [truncated ${text.length - MAX_OUTPUT_CHARS} chars] …\n${text.slice(-half)}`;
}

export const runCommandTool: Tool = {
  definition: {
    name: 'run_command',
    description:
      'Run a shell command inside the project directory (e.g. install dependencies, run a script, run tests/build). Has a timeout and output is captured, not interactive.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute.' },
        timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds (default 120000).' },
      },
      required: ['command'],
    },
    riskLevel: 'exec',
  },
  async execute(args, ctx: ToolContext) {
    const command = String(args.command ?? '');
    if (!command.trim()) return fail('command is required');
    const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 120_000;
    const result = await runShellCommand(command, ctx.projectRoot, timeoutMs);
    const combined = `$ ${command}\n${truncateOutput(result.stdout)}${
      result.stderr ? `\n--- stderr ---\n${truncateOutput(result.stderr)}` : ''
    }`;
    if (result.timedOut) {
      return fail(`${combined}\n\n(command timed out after ${timeoutMs}ms and was killed)`);
    }
    if (result.code !== 0) {
      return fail(`${combined}\n\n(exit code ${result.code})`);
    }
    return ok(combined, { exitCode: result.code });
  },
};

export const installDependencyTool: Tool = {
  definition: {
    name: 'install_dependency',
    description:
      'Install one or more packages using the project\'s package manager (npm/yarn/pnpm/pip/poetry/etc — pass the full install command).',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Full install command, e.g. "npm install express" or "pip install fastapi".',
        },
      },
      required: ['command'],
    },
    riskLevel: 'write',
  },
  async execute(args, ctx: ToolContext) {
    const command = String(args.command ?? '');
    if (!command.trim()) return fail('command is required');
    const result = await runShellCommand(command, ctx.projectRoot, 180_000);
    const combined = `$ ${command}\n${truncateOutput(result.stdout)}${
      result.stderr ? `\n--- stderr ---\n${truncateOutput(result.stderr)}` : ''
    }`;
    if (result.timedOut || result.code !== 0) {
      return fail(`${combined}\n\n(${result.timedOut ? 'timed out' : `exit code ${result.code}`})`);
    }
    return ok(combined, { exitCode: result.code });
  },
};

export const shellTools: Tool[] = [runCommandTool, installDependencyTool];
