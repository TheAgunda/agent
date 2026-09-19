import fs from 'node:fs';
import path from 'node:path';
import type { Tool, ToolContext } from './types.js';
import { ok, fail } from './types.js';
import { listProjectFiles } from '../context/indexer.js';

function resolveInProject(projectRoot: string, relPath: string): string {
  return path.resolve(projectRoot, relPath);
}

export const readFileTool: Tool = {
  definition: {
    name: 'read_file',
    description: 'Read the full contents of a file in the project, optionally a line range.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the project root.' },
        startLine: { type: 'number', description: 'Optional 1-indexed start line.' },
        endLine: { type: 'number', description: 'Optional 1-indexed inclusive end line.' },
      },
      required: ['path'],
    },
    riskLevel: 'read',
  },
  async execute(args, ctx: ToolContext) {
    const p = resolveInProject(ctx.projectRoot, String(args.path));
    if (!fs.existsSync(p)) return fail(`File not found: ${args.path}`);
    if (fs.statSync(p).isDirectory()) return fail(`${args.path} is a directory, not a file.`);
    const raw = fs.readFileSync(p, 'utf-8');
    const lines = raw.split('\n');
    const start = typeof args.startLine === 'number' ? Math.max(1, args.startLine) : 1;
    const end = typeof args.endLine === 'number' ? Math.min(lines.length, args.endLine) : lines.length;
    const slice = lines.slice(start - 1, end);
    const numbered = slice.map((l, i) => `${start + i}\t${l}`).join('\n');
    return ok(numbered, { path: args.path, totalLines: lines.length });
  },
};

export const writeFileTool: Tool = {
  definition: {
    name: 'write_file',
    description: 'Create a new file or fully overwrite an existing one with the given content.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the project root.' },
        content: { type: 'string', description: 'Full file content to write.' },
      },
      required: ['path', 'content'],
    },
    riskLevel: 'write',
  },
  async execute(args, ctx: ToolContext) {
    const p = resolveInProject(ctx.projectRoot, String(args.path));
    const existed = fs.existsSync(p);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(args.content ?? ''), 'utf-8');
    return ok(`${existed ? 'Overwrote' : 'Created'} ${args.path} (${String(args.content ?? '').length} bytes)`, {
      path: args.path,
      created: !existed,
    });
  },
};

export const editFileTool: Tool = {
  definition: {
    name: 'edit_file',
    description:
      'Apply a targeted find-and-replace edit to an existing file. `oldText` must match exactly once; use enough surrounding context to make it unique.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the project root.' },
        oldText: { type: 'string', description: 'Exact text to find (must be unique in the file).' },
        newText: { type: 'string', description: 'Replacement text.' },
      },
      required: ['path', 'oldText', 'newText'],
    },
    riskLevel: 'write',
  },
  async execute(args, ctx: ToolContext) {
    const p = resolveInProject(ctx.projectRoot, String(args.path));
    if (!fs.existsSync(p)) return fail(`File not found: ${args.path}. Use write_file to create it.`);
    const content = fs.readFileSync(p, 'utf-8');
    const oldText = String(args.oldText ?? '');
    const occurrences = content.split(oldText).length - 1;
    if (occurrences === 0) {
      return fail(
        `Could not find the given text in ${args.path}. Nothing was changed. Re-read the file to get exact current content before editing.`
      );
    }
    if (occurrences > 1) {
      return fail(
        `The given text appears ${occurrences} times in ${args.path}; oldText must be unique. Add more surrounding context.`
      );
    }
    const updated = content.replace(oldText, String(args.newText ?? ''));
    fs.writeFileSync(p, updated, 'utf-8');
    return ok(`Edited ${args.path}`, { path: args.path });
  },
};

export const deleteFileTool: Tool = {
  definition: {
    name: 'delete_file',
    description: 'Delete a file from the project. This is irreversible outside of version control.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path relative to the project root.' } },
      required: ['path'],
    },
    riskLevel: 'destructive',
  },
  async execute(args, ctx: ToolContext) {
    const p = resolveInProject(ctx.projectRoot, String(args.path));
    if (!fs.existsSync(p)) return fail(`File not found: ${args.path}`);
    fs.rmSync(p, { force: true });
    return ok(`Deleted ${args.path}`, { path: args.path });
  },
};

export const listDirectoryTool: Tool = {
  definition: {
    name: 'list_directory',
    description: 'List files and subdirectories at a given path in the project.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the project root. Defaults to project root.' },
      },
    },
    riskLevel: 'read',
  },
  async execute(args, ctx: ToolContext) {
    const rel = typeof args.path === 'string' && args.path.length > 0 ? args.path : '.';
    const p = resolveInProject(ctx.projectRoot, rel);
    if (!fs.existsSync(p)) return fail(`Path not found: ${rel}`);
    const entries = fs.readdirSync(p, { withFileTypes: true });
    const lines = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => `${e.isDirectory() ? 'd' : 'f'}  ${e.name}`);
    return ok(lines.join('\n') || '(empty directory)', { path: rel, count: entries.length });
  },
};

export const searchFilesTool: Tool = {
  definition: {
    name: 'search_files',
    description: 'Search project files for a text or regex pattern. Returns matching file:line results.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Text or JS-regex pattern to search for.' },
        globPath: { type: 'string', description: 'Optional path prefix to restrict the search to.' },
        maxResults: { type: 'number', description: 'Maximum number of matches to return (default 50).' },
      },
      required: ['pattern'],
    },
    riskLevel: 'read',
  },
  async execute(args, ctx: ToolContext) {
    const pattern = String(args.pattern ?? '');
    if (!pattern) return fail('pattern is required');
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch {
      regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
    const scope = typeof args.globPath === 'string' ? args.globPath : '.';
    const maxResults = typeof args.maxResults === 'number' ? args.maxResults : 50;
    const files = listProjectFiles(ctx.projectRoot).filter((f) => f.startsWith(scope === '.' ? '' : scope));
    const results: string[] = [];
    for (const relFile of files) {
      if (results.length >= maxResults) break;
      const abs = path.join(ctx.projectRoot, relFile);
      let content: string;
      try {
        content = fs.readFileSync(abs, 'utf-8');
      } catch {
        continue;
      }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length && results.length < maxResults; i++) {
        if (regex.test(lines[i])) {
          results.push(`${relFile}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
        }
      }
    }
    if (results.length === 0) return ok(`No matches for "${pattern}"`);
    return ok(results.join('\n'), { count: results.length });
  },
};

export const filesystemTools: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  listDirectoryTool,
  searchFilesTool,
];
