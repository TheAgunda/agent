import { randomUUID } from 'node:crypto';
import type { ChatMessage, ToolCall } from '../types/index.js';
import { openDatabase, type DB } from '../db/index.js';

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

export interface ToolRunRecord {
  id: number;
  sessionId: string | null;
  toolName: string;
  arguments: string;
  ok: boolean;
  output: string;
  durationMs: number;
  createdAt: string;
}

interface SessionRow {
  id: string;
  goal: string;
  status: SessionRecord['status'];
  iterations: number;
  summary: string | null;
  plan_id: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: number;
  role: ChatMessage['role'];
  content: string;
  tool_call_id: string | null;
  tool_name: string | null;
}

interface ToolCallRow {
  id: string;
  message_id: number;
  name: string;
  arguments: string;
}

const now = () => new Date().toISOString();

/**
 * Sessions, their messages and tool calls live in SQLite (`.agent/agent.db`).
 * `save()` is incremental: it upserts the session row and appends only the messages
 * that aren't stored yet, so long transcripts aren't rewritten on every iteration.
 */
export class SessionStore {
  private readonly db: DB;

  constructor(projectRoot: string) {
    this.db = openDatabase(projectRoot);
  }

  create(goal: string): SessionRecord {
    const ts = now();
    const record: SessionRecord = {
      id: randomUUID(),
      goal,
      createdAt: ts,
      updatedAt: ts,
      status: 'running',
      messages: [],
      iterations: 0,
    };
    this.db
      .prepare(
        `INSERT INTO sessions (id, goal, status, iterations, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`
      )
      .run(record.id, goal, record.status, ts, ts);
    return record;
  }

  save(record: SessionRecord): void {
    record.updatedAt = now();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE sessions
             SET goal = ?, status = ?, iterations = ?, summary = ?, plan_id = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          record.goal,
          record.status,
          record.iterations,
          record.summary ?? null,
          record.planId ?? null,
          record.updatedAt,
          record.id
        );

      const stored = (
        this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?').get(record.id) as { n: number }
      ).n;

      const insertMsg = this.db.prepare(
        `INSERT INTO messages (session_id, seq, role, content, tool_call_id, tool_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      const insertCall = this.db.prepare(
        `INSERT INTO tool_calls (id, message_id, position, name, arguments) VALUES (?, ?, ?, ?, ?)`
      );

      for (let seq = stored; seq < record.messages.length; seq++) {
        const m = record.messages[seq];
        const info = insertMsg.run(
          record.id,
          seq,
          m.role,
          m.content,
          m.toolCallId ?? null,
          m.toolName ?? null,
          now()
        );
        (m.toolCalls ?? []).forEach((tc, position) => {
          insertCall.run(tc.id, Number(info.lastInsertRowid), position, tc.name, JSON.stringify(tc.arguments));
        });
      }
    });
    tx();
  }

  load(id: string): SessionRecord | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
    return row ? this.hydrate(row, true) : null;
  }

  latest(): SessionRecord | null {
    const row = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC, rowid DESC LIMIT 1').get() as
      | SessionRow
      | undefined;
    return row ? this.hydrate(row, true) : null;
  }

  /** Session summaries (without message bodies), newest first. */
  list(limit = 20): SessionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions ORDER BY updated_at DESC, rowid DESC LIMIT ?')
      .all(limit) as SessionRow[];
    return rows.map((r) => this.hydrate(r, false));
  }

  logToolRun(run: {
    sessionId: string | null;
    toolName: string;
    arguments: Record<string, unknown>;
    ok: boolean;
    output: string;
    durationMs: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO tool_runs (session_id, tool_name, arguments, ok, output, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.sessionId,
        run.toolName,
        JSON.stringify(run.arguments),
        run.ok ? 1 : 0,
        run.output.slice(0, 20_000),
        Math.round(run.durationMs),
        now()
      );
  }

  listToolRuns(sessionId?: string, limit = 50): ToolRunRecord[] {
    const rows = (
      sessionId
        ? this.db.prepare('SELECT * FROM tool_runs WHERE session_id = ? ORDER BY id DESC LIMIT ?').all(sessionId, limit)
        : this.db.prepare('SELECT * FROM tool_runs ORDER BY id DESC LIMIT ?').all(limit)
    ) as any[];
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      toolName: r.tool_name,
      arguments: r.arguments,
      ok: r.ok === 1,
      output: r.output,
      durationMs: r.duration_ms,
      createdAt: r.created_at,
    }));
  }

  private hydrate(row: SessionRow, withMessages: boolean): SessionRecord {
    return {
      id: row.id,
      goal: row.goal,
      status: row.status,
      iterations: row.iterations,
      summary: row.summary ?? undefined,
      planId: row.plan_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: withMessages ? this.loadMessages(row.id) : [],
    };
  }

  private loadMessages(sessionId: string): ChatMessage[] {
    const msgs = this.db
      .prepare('SELECT id, role, content, tool_call_id, tool_name FROM messages WHERE session_id = ? ORDER BY seq')
      .all(sessionId) as MessageRow[];
    if (msgs.length === 0) return [];

    const calls = this.db
      .prepare(
        `SELECT tc.id, tc.message_id, tc.name, tc.arguments
           FROM tool_calls tc JOIN messages m ON m.id = tc.message_id
          WHERE m.session_id = ? ORDER BY tc.message_id, tc.position`
      )
      .all(sessionId) as ToolCallRow[];

    const byMessage = new Map<number, ToolCall[]>();
    for (const c of calls) {
      const list = byMessage.get(c.message_id) ?? [];
      list.push({ id: c.id, name: c.name, arguments: JSON.parse(c.arguments) });
      byMessage.set(c.message_id, list);
    }

    return msgs.map((m) => {
      const message: ChatMessage = { role: m.role, content: m.content };
      if (m.tool_call_id) message.toolCallId = m.tool_call_id;
      if (m.tool_name) message.toolName = m.tool_name;
      const tcs = byMessage.get(m.id);
      if (tcs) message.toolCalls = tcs;
      return message;
    });
  }
}
