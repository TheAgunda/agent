import fs from 'node:fs';
import path from 'node:path';
import type { ProjectInfo } from '../types/index.js';
import { buildProjectInfo, listProjectFiles } from './indexer.js';
import { selectRelevantFiles } from './selector.js';
import { estimateTokens } from '../utils/tokenEstimate.js';

export interface ContextManagerOptions {
  projectRoot: string;
  contextLimit: number;
  ignore: string[];
}

export interface BuiltContext {
  projectInfo: ProjectInfo;
  summaryBlock: string;
  fileContentBlock: string;
  includedFiles: string[];
  estimatedTokens: number;
}

/**
 * Owns "what does the model get to see about this repo" for a given turn.
 * Re-indexes lazily and keeps context within `contextLimit` tokens.
 */
export class ContextManager {
  private projectInfo: ProjectInfo;
  private recentlyTouched: string[] = [];

  constructor(private readonly options: ContextManagerOptions) {
    this.projectInfo = buildProjectInfo(options.projectRoot, options.ignore);
  }

  markTouched(relPath: string): void {
    this.recentlyTouched = [relPath, ...this.recentlyTouched.filter((p) => p !== relPath)].slice(0, 20);
  }

  refreshProjectInfo(): ProjectInfo {
    this.projectInfo = buildProjectInfo(this.options.projectRoot, this.options.ignore);
    return this.projectInfo;
  }

  getProjectInfo(): ProjectInfo {
    return this.projectInfo;
  }

  private buildSummaryBlock(): string {
    const p = this.projectInfo;
    const lines = [
      `Project root: ${p.root}`,
      `Files indexed: ${p.fileCount}`,
      `Languages: ${p.languages.join(', ') || 'unknown'}`,
      `Frameworks/libraries detected: ${p.frameworks.join(', ') || 'none detected'}`,
      `Package managers: ${p.packageManagers.join(', ') || 'none detected'}`,
      `Git: ${p.hasGit ? `yes (branch: ${p.gitBranch ?? 'unknown'})` : 'no'}`,
      `Test command: ${p.testCommand ?? 'not detected — ask the user or infer from project config'}`,
      `Lint command: ${p.lintCommand ?? 'not detected'}`,
      `Format command: ${p.formatCommand ?? 'not detected'}`,
    ];
    return lines.join('\n');
  }

  /** Directory tree (top few levels) — cheap orientation without dumping file contents. */
  private buildTreeBlock(maxEntries = 150): string {
    const files = listProjectFiles(this.options.projectRoot, this.options.ignore);
    const shown = files.slice(0, maxEntries).sort();
    const suffix = files.length > maxEntries ? `\n… and ${files.length - maxEntries} more files` : '';
    return shown.join('\n') + suffix;
  }

  buildContext(taskDescription: string): BuiltContext {
    const summaryBlock = this.buildSummaryBlock();
    const treeBlock = this.buildTreeBlock();
    const summaryTokens = estimateTokens(summaryBlock) + estimateTokens(treeBlock);
    const fileBudget = Math.max(0, this.options.contextLimit - summaryTokens - 500);

    const { selected } = selectRelevantFiles(this.options.projectRoot, taskDescription, {
      tokenBudget: fileBudget,
      recentlyTouched: this.recentlyTouched,
      extraIgnores: this.options.ignore,
    });

    const fileBlocks = selected.map((entry) => {
      const abs = path.join(this.options.projectRoot, entry.path);
      let content = '';
      try {
        content = fs.readFileSync(abs, 'utf-8');
      } catch {
        content = '(binary or unreadable file, skipped)';
      }
      return `--- FILE: ${entry.path} (${entry.reason}) ---\n${content}`;
    });

    const fileContentBlock = fileBlocks.join('\n\n');

    return {
      projectInfo: this.projectInfo,
      summaryBlock: `${summaryBlock}\n\nProject file tree (partial):\n${treeBlock}`,
      fileContentBlock,
      includedFiles: selected.map((s) => s.path),
      estimatedTokens: summaryTokens + estimateTokens(fileContentBlock),
    };
  }
}
