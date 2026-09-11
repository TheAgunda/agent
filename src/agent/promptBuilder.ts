import type { Plan } from '../types/index.js';
import type { AgentConfig } from '../config/schema.js';
import type { BuiltContext } from '../context/manager.js';

export function buildSystemPrompt(options: {
  config: AgentConfig;
  context: BuiltContext;
  memorySummary: string;
  plan: Plan | null;
  planRendered: string | null;
}): string {
  const { config, context, memorySummary, plan, planRendered } = options;
  const p = context.projectInfo;

  const parts = [
    options.config.systemPrompt?.trim() ||
      `You are an autonomous coding agent operating inside a real project directory. You accomplish software
engineering tasks by reading and writing real files and running real commands through the tools provided —
never by just describing changes in prose.`,
    '',
    '## Project',
    context.summaryBlock,
    '',
    '## Relevant file contents',
    context.fileContentBlock || '(no files selected as relevant to this task yet — use list_directory / search_files / read_file to explore)',
  ];

  if (memorySummary.trim()) {
    parts.push('', '## Project memory (persisted notes from previous sessions)', memorySummary);
  }

  if (plan && planRendered) {
    parts.push(
      '',
      '## Current plan',
      `Goal: ${plan.goal}`,
      planRendered,
      '',
      'Use `update_task_status` to mark a task in_progress before working on it and done/failed once finished. Work through tasks in order unless a later one is blocked.'
    );
  }

  parts.push(
    '',
    '## How to work',
    `- Use tools to make real changes. Do not just print code in your response — write it to files with write_file/edit_file.`,
    `- Prefer edit_file for small changes to existing files; use write_file for new files or full rewrites.`,
    `- Before editing a file you have not already read in this conversation, read it first so your oldText matches exactly.`,
    `- After making non-trivial code changes, run the project's tests${config.agent.autoTest ? ' (this is expected of you)' : ''}${
      config.agent.autoLint ? ' and linter' : ''
    } and fix failures before declaring the task done.`,
    `- If a command fails, read the error output carefully, inspect the relevant file(s), and fix the root cause rather than retrying blindly.`,
    `- Keep going across multiple tool calls until the whole task is actually done — do not stop after a single edit if more work remains.`,
    `- Permission mode is "${config.permissions.mode}": some actions may require user confirmation before they execute; if declined, adapt your approach.`,
    `- When the ENTIRE task is complete and verified (tests passing if applicable), respond with NO tool calls and start your message with "TASK_COMPLETE:" followed by a concise summary of what you did, files changed, and how to run/verify it.`,
    `- If you get stuck after reasonable attempts, respond with no tool calls starting with "TASK_BLOCKED:" explaining what's blocking you and what you'd need from the user.`
  );

  return parts.join('\n');
}
