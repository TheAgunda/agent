import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChatMessage } from '../types/index.js';
import { projectAgentDir } from '../config/loader.js';

export interface SessionRecord {
  id: string;
  goal: string;
  createdAt: string;
  updatedAt: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  messages: ChatMessage[];
  planId?: string;
  iterations: number;
  summary?: string;
}

function sessionsDir(projectRoot: string): string {
  return path.join(projectAgentDir(projectRoot), 'sessions');
}

function sessionPath(projectRoot: string, id: string): string {
  return path.join(sessionsDir(projectRoot), `${id}.json`);
}

export class SessionStore {
  constructor(private readonly projectRoot: string) {}

  create(goal: string): SessionRecord {
    const record: SessionRecord = {
      id: randomUUID(),
      goal,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'running',
      messages: [],
      iterations: 0,
    };
    this.save(record);
    return record;
  }

  save(record: SessionRecord): void {
    fs.mkdirSync(sessionsDir(this.projectRoot), { recursive: true });
    record.updatedAt = new Date().toISOString();
    fs.writeFileSync(sessionPath(this.projectRoot, record.id), JSON.stringify(record, null, 2), 'utf-8');
  }

  load(id: string): SessionRecord | null {
    const p = sessionPath(this.projectRoot, id);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as SessionRecord;
  }

  latest(): SessionRecord | null {
    const dir = sessionsDir(this.projectRoot);
    if (!fs.existsSync(dir)) return null;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length === 0) return null;
    return this.load(files[0].f.replace(/\.json$/, ''));
  }

  list(limit = 20): SessionRecord[] {
    const dir = sessionsDir(this.projectRoot);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as SessionRecord)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, limit);
  }
}
