import { openDatabase, type DB } from '../db/index.js';

export interface MemoryEntry {
  id?: number;
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

export const MEMORY_CATEGORIES = Object.keys(CATEGORY_HEADINGS) as MemoryEntry['category'][];

/**
 * Persistent project memory stored in the `memory_entries` table of `.agent/agent.db`.
 * Entries are capped per category (oldest pruned first) so the prompt summary stays small.
 */
export class MemoryManager {
  private readonly db: DB;

  constructor(
    projectRoot: string,
    private readonly maxEntries = 200
  ) {
    this.db = openDatabase(projectRoot);
  }

  remember(category: MemoryEntry['category'], text: string): void {
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO memory_entries (category, text, created_at) VALUES (?, ?, ?)')
        .run(category, text, new Date().toISOString());
      this.db
        .prepare(
          `DELETE FROM memory_entries
            WHERE category = ? AND id NOT IN (
              SELECT id FROM memory_entries WHERE category = ? ORDER BY id DESC LIMIT ?
            )`
        )
        .run(category, category, this.maxEntries);
    })();
  }

  /** Remove one entry by id. Returns whether a row was deleted. */
  forget(id: number): boolean {
    return this.db.prepare('DELETE FROM memory_entries WHERE id = ?').run(id).changes > 0;
  }

  list(category?: MemoryEntry['category']): MemoryEntry[] {
    const rows = (
      category
        ? this.db.prepare('SELECT * FROM memory_entries WHERE category = ? ORDER BY id').all(category)
        : this.db.prepare('SELECT * FROM memory_entries ORDER BY id').all()
    ) as { id: number; category: MemoryEntry['category']; text: string; created_at: string }[];
    return rows.map((r) => ({ id: r.id, category: r.category, text: r.text, timestamp: r.created_at }));
  }

  /** Human-readable markdown rendering of everything in memory (for `agent memory` / export). */
  readAll(): string {
    const all = this.list();
    if (all.length === 0) return '';
    const parts = ['# Project Memory', ''];
    for (const category of MEMORY_CATEGORIES) {
      const entries = all.filter((e) => e.category === category);
      if (entries.length === 0) continue;
      parts.push(`## ${CATEGORY_HEADINGS[category]}`, '');
      for (const e of entries) parts.push(`- [${e.timestamp}] ${e.text}`);
      parts.push('');
    }
    return parts.join('\n');
  }

  /** A compact version suitable for injecting into the system prompt. */
  summaryForPrompt(maxCharsPerCategory = 800): string {
    const all = this.list();
    const parts: string[] = [];
    for (const category of MEMORY_CATEGORIES) {
      const entries = all.filter((e) => e.category === category);
      if (entries.length === 0) continue;
      const text = entries.map((e) => `- ${e.text}`).join('\n');
      parts.push(`${CATEGORY_HEADINGS[category]}:\n${text.slice(-maxCharsPerCategory)}`);
    }
    return parts.join('\n\n');
  }

  exists(): boolean {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM memory_entries').get() as { n: number }).n > 0;
  }
}
