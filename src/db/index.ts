import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { projectAgentDir } from '../config/loader.js';

export type DB = Database.Database;

/**
 * Ordered, append-only migrations. Never edit an existing entry — add a new one.
 * `PRAGMA user_version` tracks how many have been applied.
 */
const MIGRATIONS: string[] = [
  // 1: core schema
  `
  CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    goal        TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('running','completed','failed','interrupted')),
    iterations  INTEGER NOT NULL DEFAULT 0,
    summary     TEXT,
    plan_id     TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);

  CREATE TABLE messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq           INTEGER NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool')),
    content       TEXT NOT NULL,
    tool_call_id  TEXT,
    tool_name     TEXT,
    created_at    TEXT NOT NULL,
    UNIQUE (session_id, seq)
  );

  CREATE TABLE tool_calls (
    id            TEXT NOT NULL,
    message_id    INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    position      INTEGER NOT NULL,
    name          TEXT NOT NULL,
    arguments     TEXT NOT NULL,
    PRIMARY KEY (message_id, position)
  );

  CREATE TABLE plans (
    id          TEXT PRIMARY KEY,
    goal        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE plan_tasks (
    id           TEXT PRIMARY KEY,
    plan_id      TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL,
    description  TEXT NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('pending','in_progress','done','failed','skipped')),
    notes        TEXT,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX idx_plan_tasks_plan ON plan_tasks(plan_id, position);

  CREATE TABLE memory_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category    TEXT NOT NULL CHECK (category IN
                  ('decision','convention','command','requirement','preference','issue','result')),
    text        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX idx_memory_category ON memory_entries(category, id);
  `,
  // 2: audit log of every tool execution (queryable history of what the agent did)
  `
  CREATE TABLE tool_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    tool_name   TEXT NOT NULL,
    arguments   TEXT NOT NULL,
    ok          INTEGER NOT NULL,
    output      TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX idx_tool_runs_session ON tool_runs(session_id, id);
  `,
];

const open = new Map<string, DB>();

export function databasePath(projectRoot: string): string {
  return path.join(projectAgentDir(projectRoot), 'agent.db');
}

function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

/** Open (creating + migrating if needed) the project's database. One connection per path per process. */
export function openDatabase(projectRoot: string): DB {
  const file = databasePath(projectRoot);
  const existing = open.get(file);
  if (existing && existing.open) return existing;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  open.set(file, db);
  return db;
}

export function closeDatabase(projectRoot: string): void {
  const file = databasePath(projectRoot);
  const db = open.get(file);
  if (db?.open) db.close();
  open.delete(file);
}

export function closeAllDatabases(): void {
  for (const db of open.values()) if (db.open) db.close();
  open.clear();
}

export const SCHEMA_VERSION = MIGRATIONS.length;
