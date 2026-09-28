import type { Tool, ToolContext } from './types.js';
import { ok, fail } from './types.js';
import { runShellCommand } from './shell.js';

const MAX_OUTPUT_CHARS = 8000;
function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  const half = MAX_OUTPUT_CHARS / 2;
  return `${text.slice(0, half)}\n… [truncated ${text.length - MAX_OUTPUT_CHARS} chars] …\n${text.slice(-half)}`;
}

function makeCommandTool(name: string, description: string, configKey: 'test' | 'lint' | 'format'): Tool {
  return {
    definition: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Override command to run instead of the project-detected default.',
          },
        },
      },
      riskLevel: 'exec',
    },
    async execute(args, ctx: ToolContext) {
      const command = (typeof args.command === 'string' && args.command) || ctx.commands?.[configKey];
      if (!command) {
        return fail(
          `No ${configKey} command is configured or detected for this project. Provide one via the "command" argument or set commands.${configKey} in .agent/config.yaml.`
        );
      }
      const result = await runShellCommand(command, ctx.projectRoot, 180_000);
      const combined = `$ ${command}\n${truncateOutput(result.stdout)}${
        result.stderr ? `\n--- stderr ---\n${truncateOutput(result.stderr)}` : ''
      }`;
      if (result.timedOut) return fail(`${combined}\n\n(timed out)`);
      if (result.code !== 0) return fail(`${combined}\n\n(exit code ${result.code})`);
      return ok(combined, { exitCode: result.code });
    },
  };
}

export const runTestsTool = makeCommandTool('run_tests', 'Run the project test suite.', 'test');
export const runLinterTool = makeCommandTool('run_linter', 'Run the project linter.', 'lint');
export const runFormatterTool = makeCommandTool('run_formatter', 'Run the project code formatter.', 'format');

export const testingTools: Tool[] = [runTestsTool, runLinterTool, runFormatterTool];
