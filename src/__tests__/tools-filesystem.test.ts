import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileTool, writeFileTool, editFileTool, deleteFileTool, listDirectoryTool, searchFilesTool } from '../tools/filesystem.js';
import { invalidateFileListCache } from '../context/indexer.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-fs-test-'));
  invalidateFileListCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const ctx = () => ({ projectRoot: tmpDir });

describe('filesystem tools', () => {
  it('write_file creates a new file, including nested directories', async () => {
    const result = await writeFileTool.execute({ path: 'src/nested/a.ts', content: 'export const x = 1;' }, ctx());
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'src/nested/a.ts'), 'utf-8')).toBe('export const x = 1;');
  });

  it('read_file returns numbered lines and reports total line count', async () => {
    fs.writeFileSync(path.join(tmpDir, 'f.txt'), 'a\nb\nc');
    const result = await readFileTool.execute({ path: 'f.txt' }, ctx());
    expect(result.ok).toBe(true);
    expect(result.output).toContain('1\ta');
    expect(result.output).toContain('3\tc');
  });

  it('read_file fails clearly for a missing file', async () => {
    const result = await readFileTool.execute({ path: 'missing.txt' }, ctx());
    expect(result.ok).toBe(false);
  });

  it('edit_file replaces a unique match', async () => {
    fs.writeFileSync(path.join(tmpDir, 'f.txt'), 'hello world');
    const result = await editFileTool.execute({ path: 'f.txt', oldText: 'world', newText: 'there' }, ctx());
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'f.txt'), 'utf-8')).toBe('hello there');
  });

  it('edit_file fails when oldText is not unique', async () => {
    fs.writeFileSync(path.join(tmpDir, 'f.txt'), 'foo foo');
    const result = await editFileTool.execute({ path: 'f.txt', oldText: 'foo', newText: 'bar' }, ctx());
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/appears 2 times/);
  });

  it('edit_file fails when oldText is not found, and does not modify the file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'f.txt'), 'hello world');
    const result = await editFileTool.execute({ path: 'f.txt', oldText: 'nope', newText: 'x' }, ctx());
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(path.join(tmpDir, 'f.txt'), 'utf-8')).toBe('hello world');
  });

  it('delete_file removes an existing file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'f.txt'), 'x');
    const result = await deleteFileTool.execute({ path: 'f.txt' }, ctx());
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'f.txt'))).toBe(false);
  });

  it('list_directory lists files and directories', async () => {
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'x');
    const result = await listDirectoryTool.execute({ path: '.' }, ctx());
    expect(result.output).toContain('a.txt');
    expect(result.output).toContain('sub');
  });

  it('search_files finds matching lines across files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'const needle = 1;\nconst other = 2;');
    fs.writeFileSync(path.join(tmpDir, 'b.ts'), 'no match here');
    invalidateFileListCache();
    const result = await searchFilesTool.execute({ pattern: 'needle' }, ctx());
    expect(result.ok).toBe(true);
    expect(result.output).toContain('a.ts:1');
  });
});
