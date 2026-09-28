import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildProjectInfo, listProjectFiles, invalidateFileListCache } from '../context/indexer.js';
import { selectRelevantFiles } from '../context/selector.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-index-test-'));
  invalidateFileListCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(rel: string, content: string) {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe('indexer', () => {
  it('respects .gitignore and default ignore patterns', () => {
    write('.gitignore', 'ignored.txt\n');
    write('ignored.txt', 'x');
    write('kept.ts', 'x');
    write('node_modules/pkg/index.js', 'x');
    const files = listProjectFiles(tmpDir);
    expect(files).toContain('kept.ts');
    expect(files).not.toContain('ignored.txt');
    expect(files.some((f) => f.startsWith('node_modules'))).toBe(false);
  });

  it('detects language and framework from package.json', () => {
    write('package.json', JSON.stringify({ dependencies: { express: '^4.0.0' } }));
    write('src/index.js', 'x');
    write('package-lock.json', '{}');
    const info = buildProjectInfo(tmpDir);
    expect(info.languages).toContain('JavaScript');
    expect(info.frameworks).toContain('Express');
    expect(info.packageManagers).toContain('npm');
  });

  it('detects the npm test command from package.json scripts', () => {
    write('package.json', JSON.stringify({ scripts: { test: 'vitest run' } }));
    const info = buildProjectInfo(tmpDir);
    expect(info.testCommand).toBe('npm test');
  });

  it('reports git status when a .git directory exists', () => {
    fs.mkdirSync(path.join(tmpDir, '.git'));
    fs.writeFileSync(path.join(tmpDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const info = buildProjectInfo(tmpDir);
    expect(info.hasGit).toBe(true);
    expect(info.gitBranch).toBe('main');
  });
});

describe('context selector', () => {
  it('prioritizes files whose path matches query tokens', () => {
    write('src/auth/login.ts', 'x'.repeat(100));
    write('src/unrelated/thing.ts', 'x'.repeat(100));
    const result = selectRelevantFiles(tmpDir, 'implement login authentication', { tokenBudget: 10_000 });
    const paths = result.selected.map((s) => s.path);
    expect(paths.indexOf('src/auth/login.ts')).toBeLessThan(paths.indexOf('src/unrelated/thing.ts'));
  });

  it('stays within the token budget on a large repo', () => {
    for (let i = 0; i < 50; i++) write(`src/file${i}.ts`, 'x'.repeat(2000));
    const result = selectRelevantFiles(tmpDir, 'refactor everything', { tokenBudget: 2000 });
    expect(result.estimatedTokens).toBeLessThanOrEqual(2000 + 600); // small slack for the first oversized-relative-to-remaining-budget file
    expect(result.selected.length).toBeLessThan(50);
  });

  it('boosts recently touched files', () => {
    write('src/a.ts', 'x'.repeat(50));
    write('src/b.ts', 'x'.repeat(50));
    const result = selectRelevantFiles(tmpDir, 'do something', {
      tokenBudget: 10_000,
      recentlyTouched: ['src/b.ts'],
    });
    const bEntry = result.selected.find((s) => s.path === 'src/b.ts');
    const aEntry = result.selected.find((s) => s.path === 'src/a.ts');
    expect(bEntry!.relevance).toBeGreaterThan(aEntry!.relevance);
  });
});
