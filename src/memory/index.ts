import fs from 'node:fs';
import path from 'node:path';
import { projectAgentDir } from '../config/loader.js';

export interface MemoryEntry {
  timestamp: string;
  category: 'decision' | 'convention' | 'command' | 'requirement' | 'preference' | 'issue' | 'result';
  text: string;
}

const CATEGORY_HEADINGS: Record<MemoryEntry['category'], string> = {
  decision: 'Architecture Decisions',
  convention: 'Coding Conventions',
  command: 'Important Commands',
  requirement: 'Project Requirements',
  preference: 'User Preferences',
  issue: 'Known Issues',
  result: 'Previous Task Results',
};

function memoryPath(projectRoot: string): string {
  return path.join(projectAgentDir(projectRoot), 'memory.md');
}

/**
 * Simple, human-readable/editable persistent memory stored at `.agent/memory.md`.
 * Organized by category so both the model and a human skimming the file can find
 * things quickly. Deliberately not a vector store — most projects' durable facts
 * (conventions, decisions, gotchas) fit comfortably in a few KB of markdown, and
 * a plain file stays inspectable and editable by the user.
 */
export class MemoryManager {
  private readonly filePath: string;
  private readonly maxEntries: number;

  constructor(
    private readonly projectRoot: string,
    maxEntries = 200
  ) {
    this.filePath = memoryPath(projectRoot);
    this.maxEntries = maxEntries;
  }

  private load(): Map<MemoryEntry['category'], MemoryEntry[]> {
    const byCategory = new Map<MemoryEntry['category'], MemoryEntry[]>();
    for (const cat of Object.keys(CATEGORY_HEADINGS) as MemoryEntry['category'][]) byCategory.set(cat, []);
    if (!fs.existsSync(this.filePath)) return byCategory;

    const content = fs.readFileSync(this.filePath, 'utf-8');
    let currentCategory: MemoryEntry['category'] | null = null;
    for (const line of content.split('\n')) {
      const headingMatch = line.match(/^## (.+)$/);
      if (headingMatch) {
        const found = (Object.entries(CATEGORY_HEADINGS).find(([, h]) => h === headingMatch[1]) ?? [])[0] as
          | MemoryEntry['category']
          | undefined;
        currentCategory = found ?? null;
        continue;
      }
      const entryMatch = line.match(/^- \[(.+?)\] (.+)$/);
      if (entryMatch && currentCategory) {
        byCategory.get(currentCategory)!.push({ timestamp: entryMatch[1], category: currentCategory, text: entryMatch[2] });
      }
    }
    return byCategory;
  }

  private save(byCategory: Map<MemoryEntry['category'], MemoryEntry[]>): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const parts = ['# Project Memory', '', '_Persistent notes the agent has learned about this project. Safe to hand-edit._', ''];
    for (const [category, heading] of Object.entries(CATEGORY_HEADINGS)) {
      const entries = byCategory.get(category as MemoryEntry['category']) ?? [];
      if (entries.length === 0) continue;
      parts.push(`## ${heading}`, '');
      for (const e of entries.slice(-this.maxEntries)) {
        parts.push(`- [${e.timestamp}] ${e.text}`);
      }
      parts.push('');
    }
    fs.writeFileSync(this.filePath, parts.join('\n'), 'utf-8');
  }

  remember(category: MemoryEntry['category'], text: string): void {
    const byCategory = this.load();
    const list = byCategory.get(category) ?? [];
    list.push({ timestamp: new Date().toISOString(), category, text });
    byCategory.set(category, list);
    this.save(byCategory);
  }

  readAll(): string {
    if (!fs.existsSync(this.filePath)) return '';
    return fs.readFileSync(this.filePath, 'utf-8');
  }

  /** A compact version suitable for injecting into the system prompt. */
  summaryForPrompt(maxCharsPerCategory = 800): string {
    const byCategory = this.load();
    const parts: string[] = [];
    for (const [category, heading] of Object.entries(CATEGORY_HEADINGS)) {
      const entries = byCategory.get(category as MemoryEntry['category']) ?? [];
      if (entries.length === 0) continue;
      const text = entries.map((e) => `- ${e.text}`).join('\n');
      parts.push(`${heading}:\n${text.slice(-maxCharsPerCategory)}`);
    }
    return parts.join('\n\n');
  }

  exists(): boolean {
    return fs.existsSync(this.filePath);
  }
}
