import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { TaskEvent, TaskRequest, TaskResult } from "../types/index.js";

export interface StoredCodexSessionRecord {
  sessionId: string;
  threadId: string;
  createdAt: string;
  updatedAt: string;
  activeTaskId?: string;
}

export interface StoredTaskTurnRecord {
  requestId: string;
  taskId: string;
  sessionId?: string;
  sourceChannel: string;
  userId: string;
  userDisplayName?: string;
  role: string;
  workflow: string;
  goal: string;
  inputText?: string;
  historyContext?: string;
  optionsJson?: string;
  status: string;
  summary?: string;
  output?: string;
  errorMessage?: string;
  structuredOutputJson?: string;
  sessionMode?: string;
  codexThreadId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface StoredTaskEventRecord {
  eventId: string;
  requestId: string;
  taskId: string;
  type: string;
  status: string;
  message?: string;
  payloadJson?: string;
  createdAt: string;
}

export interface StoredSessionHistorySummary {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  threadId?: string;
  latestTurn: {
    requestId: string;
    taskId: string;
    workflow: string;
    role: string;
    goal: string;
    status: string;
    summary?: string;
    sessionMode?: string;
    codexThreadId?: string;
    updatedAt: string;
  };
}

export interface CompleteTaskTurnInput {
  request: TaskRequest;
  result: TaskResult;
  sessionMode?: string;
  threadId?: string;
}

export interface FailTaskTurnInput {
  request: TaskRequest;
  taskId: string;
  message: string;
  completedAt?: string;
  sessionMode?: string;
  threadId?: string;
}

export interface SqliteCodexSessionRegistryOptions {
  databaseFile?: string;
  legacyRegistryFile?: string;
  maxSessions?: number;
}

interface SessionRow {
  session_id: string;
  thread_id: string;
  created_at: string;
  updated_at: string;
  active_task_id: string | null;
}

interface TurnRow {
  request_id: string;
  task_id: string;
  session_id: string | null;
  source_channel: string;
  user_id: string;
  user_display_name: string | null;
  role: string;
  workflow: string;
  goal: string;
  input_text: string | null;
  history_context: string | null;
  options_json: string | null;
  status: string;
  summary: string | null;
  output: string | null;
  error_message: string | null;
  structured_output_json: string | null;
  session_mode: string | null;
  codex_thread_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface EventRow {
  event_id: string;
  request_id: string;
  task_id: string;
  event_type: string;
  status: string;
  message: string | null;
  payload_json: string | null;
  created_at: string;
}

interface SessionSummaryRow {
  session_id: string;
  created_at: string;
  updated_at: string;
  turn_count: number;
  thread_id: string | null;
  latest_request_id: string;
  latest_task_id: string;
  latest_workflow: string;
  latest_role: string;
  latest_goal: string;
  latest_status: string;
  latest_summary: string | null;
  latest_session_mode: string | null;
  latest_codex_thread_id: string | null;
  latest_updated_at: string;
}

interface LegacyPersistedSessionRecord {
  sessionId: string;
  threadId: string;
  createdAt: string;
  updatedAt: string;
}

interface LegacyPersistedSessionRegistry {
  version: 1;
  sessions: LegacyPersistedSessionRecord[];
}

export class SqliteCodexSessionRegistry {
  private readonly databaseFile: string;
  private readonly legacyRegistryFile: string;
  private readonly maxSessions: number;
  private readonly db: Database.Database;

  constructor(options: SqliteCodexSessionRegistryOptions = {}) {
    this.databaseFile = options.databaseFile ?? resolve(process.cwd(), "infra/local/themis.db");
    this.legacyRegistryFile = options.legacyRegistryFile ?? resolve(process.cwd(), "infra/local/codex-session-registry.json");
    this.maxSessions = options.maxSessions ?? 200;

    mkdirSync(dirname(this.databaseFile), { recursive: true });
    this.db = new Database(this.databaseFile);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initializeSchema();
    this.migrateLegacyRegistryIfNeeded();
  }

  getSession(sessionId: string): StoredCodexSessionRecord | null {
    const normalized = sessionId.trim();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT session_id, thread_id, created_at, updated_at, active_task_id
          FROM codex_sessions
          WHERE session_id = ?
        `,
      )
      .get(normalized) as SessionRow | undefined;

    return row ? mapSessionRow(row) : null;
  }

  saveSession(record: StoredCodexSessionRecord): void {
    const sessionId = record.sessionId.trim();

    if (!sessionId) {
      throw new Error("Session id is required.");
    }

    this.db
      .prepare(
        `
          INSERT INTO codex_sessions (
            session_id,
            thread_id,
            created_at,
            updated_at,
            active_task_id
          ) VALUES (
            @session_id,
            @thread_id,
            @created_at,
            @updated_at,
            @active_task_id
          )
          ON CONFLICT(session_id) DO UPDATE SET
            thread_id = excluded.thread_id,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            active_task_id = excluded.active_task_id
        `,
      )
      .run({
        session_id: sessionId,
        thread_id: record.threadId.trim(),
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        active_task_id: record.activeTaskId ?? null,
      });
  }

  deleteSession(sessionId: string): boolean {
    const normalized = sessionId.trim();

    if (!normalized) {
      return false;
    }

    const result = this.db
      .prepare(
        `
          DELETE FROM codex_sessions
          WHERE session_id = ?
        `,
      )
      .run(normalized);

    return result.changes > 0;
  }

  resolveThreadId(sessionId: string): string | null {
    const normalized = sessionId.trim();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT thread_id
          FROM codex_sessions
          WHERE session_id = ?
        `,
      )
      .get(normalized) as { thread_id: string } | undefined;

    const threadId = row?.thread_id.trim();
    return threadId ? threadId : null;
  }

  pruneInactiveSessions(): void {
    const totalSessions = this.countSessions();
    const overflow = totalSessions - this.maxSessions;

    if (overflow <= 0) {
      return;
    }

    const rows = this.db
      .prepare(
        `
          SELECT session_id
          FROM codex_sessions
          WHERE active_task_id IS NULL OR active_task_id = ''
          ORDER BY updated_at ASC
          LIMIT ?
        `,
      )
      .all(overflow) as Array<{ session_id: string }>;

    if (!rows.length) {
      return;
    }

    const removeSessions = this.db.transaction((sessionIds: string[]) => {
      const statement = this.db.prepare(
        `
          DELETE FROM codex_sessions
          WHERE session_id = ?
        `,
      );

      for (const sessionId of sessionIds) {
        statement.run(sessionId);
      }
    });

    removeSessions(rows.map((row) => row.session_id));
  }

  upsertTurnFromRequest(request: TaskRequest, taskId: string): void {
    this.db
      .prepare(
        `
          INSERT INTO themis_turns (
            request_id,
            task_id,
            session_id,
            source_channel,
            user_id,
            user_display_name,
            role,
            workflow,
            goal,
            input_text,
            history_context,
            options_json,
            status,
            created_at,
            updated_at
          ) VALUES (
            @request_id,
            @task_id,
            @session_id,
            @source_channel,
            @user_id,
            @user_display_name,
            @role,
            @workflow,
            @goal,
            @input_text,
            @history_context,
            @options_json,
            @status,
            @created_at,
            @updated_at
          )
          ON CONFLICT(request_id) DO UPDATE SET
            task_id = excluded.task_id,
            session_id = excluded.session_id,
            source_channel = excluded.source_channel,
            user_id = excluded.user_id,
            user_display_name = excluded.user_display_name,
            role = excluded.role,
            workflow = excluded.workflow,
            goal = excluded.goal,
            input_text = excluded.input_text,
            history_context = excluded.history_context,
            options_json = excluded.options_json,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        request_id: request.requestId,
        task_id: taskId,
        session_id: request.channelContext.sessionId?.trim() || null,
        source_channel: request.sourceChannel,
        user_id: request.user.userId,
        user_display_name: request.user.displayName?.trim() || null,
        role: request.role,
        workflow: request.workflow,
        goal: request.goal,
        input_text: request.inputText?.trim() || null,
        history_context: request.historyContext?.trim() || null,
        options_json: stringifyJson(request.options),
        status: "queued",
        created_at: request.createdAt,
        updated_at: request.createdAt,
      });
  }

  appendTaskEvent(event: TaskEvent): void {
    const sessionMetadata = extractSessionMetadata(event.payload);
    const payloadJson = stringifyJson(event.payload);

    const applyEvent = this.db.transaction(() => {
      this.db
        .prepare(
          `
            INSERT OR REPLACE INTO themis_turn_events (
              event_id,
              request_id,
              task_id,
              event_type,
              status,
              message,
              payload_json,
              created_at
            ) VALUES (
              @event_id,
              @request_id,
              @task_id,
              @event_type,
              @status,
              @message,
              @payload_json,
              @created_at
            )
          `,
        )
        .run({
          event_id: event.eventId,
          request_id: event.requestId,
          task_id: event.taskId,
          event_type: event.type,
          status: event.status,
          message: event.message ?? null,
          payload_json: payloadJson,
          created_at: event.timestamp,
        });

      this.db
        .prepare(
          `
            UPDATE themis_turns
            SET
              status = @status,
              updated_at = @updated_at,
              session_mode = CASE
                WHEN @session_mode IS NOT NULL AND @session_mode <> '' THEN @session_mode
                ELSE session_mode
              END,
              codex_thread_id = CASE
                WHEN @codex_thread_id IS NOT NULL AND @codex_thread_id <> '' THEN @codex_thread_id
                ELSE codex_thread_id
              END,
              error_message = CASE
                WHEN @status = 'failed' THEN COALESCE(@message, error_message)
                ELSE error_message
              END
            WHERE request_id = @request_id
          `,
        )
        .run({
          request_id: event.requestId,
          status: event.status,
          updated_at: event.timestamp,
          session_mode: sessionMetadata.sessionMode ?? null,
          codex_thread_id: sessionMetadata.threadId ?? null,
          message: event.message ?? null,
        });
    });

    applyEvent();
  }

  completeTaskTurn(input: CompleteTaskTurnInput): void {
    const structuredOutputJson = stringifyJson(input.result.structuredOutput);
    const optionsJson = stringifyJson(input.request.options);
    const touchedFiles = dedupeStrings(input.result.touchedFiles ?? []);

    const completeTurn = this.db.transaction(() => {
      this.db
        .prepare(
          `
            UPDATE themis_turns
            SET
              session_id = @session_id,
              task_id = @task_id,
              source_channel = @source_channel,
              user_id = @user_id,
              user_display_name = @user_display_name,
              role = @role,
              workflow = @workflow,
              goal = @goal,
              input_text = @input_text,
              history_context = @history_context,
              options_json = @options_json,
              status = @status,
              summary = @summary,
              output = @output,
              error_message = @error_message,
              structured_output_json = @structured_output_json,
              session_mode = @session_mode,
              codex_thread_id = @codex_thread_id,
              updated_at = @updated_at,
              completed_at = @completed_at
            WHERE request_id = @request_id
          `,
        )
        .run({
          request_id: input.request.requestId,
          session_id: input.request.channelContext.sessionId?.trim() || null,
          task_id: input.result.taskId,
          source_channel: input.request.sourceChannel,
          user_id: input.request.user.userId,
          user_display_name: input.request.user.displayName?.trim() || null,
          role: input.request.role,
          workflow: input.request.workflow,
          goal: input.request.goal,
          input_text: input.request.inputText?.trim() || null,
          history_context: input.request.historyContext?.trim() || null,
          options_json: optionsJson,
          status: input.result.status,
          summary: input.result.summary,
          output: input.result.output ?? null,
          error_message: input.result.status === "failed" ? input.result.summary : null,
          structured_output_json: structuredOutputJson,
          session_mode: input.sessionMode ?? null,
          codex_thread_id: input.threadId ?? null,
          updated_at: input.result.completedAt,
          completed_at: input.result.completedAt,
        });

      this.db
        .prepare(
          `
            DELETE FROM themis_turn_files
            WHERE request_id = ?
          `,
        )
        .run(input.request.requestId);

      if (!touchedFiles.length) {
        return;
      }

      const insertFile = this.db.prepare(
        `
          INSERT OR REPLACE INTO themis_turn_files (
            request_id,
            task_id,
            file_path,
            created_at
          ) VALUES (?, ?, ?, ?)
        `,
      );

      for (const filePath of touchedFiles) {
        insertFile.run(input.request.requestId, input.result.taskId, filePath, input.result.completedAt);
      }
    });

    completeTurn();
  }

  failTaskTurn(input: FailTaskTurnInput): void {
    const completedAt = input.completedAt ?? new Date().toISOString();

    this.db
      .prepare(
        `
          UPDATE themis_turns
          SET
            status = 'failed',
            summary = @summary,
            error_message = @error_message,
            session_mode = CASE
              WHEN @session_mode IS NOT NULL AND @session_mode <> '' THEN @session_mode
              ELSE session_mode
            END,
            codex_thread_id = CASE
              WHEN @codex_thread_id IS NOT NULL AND @codex_thread_id <> '' THEN @codex_thread_id
              ELSE codex_thread_id
            END,
            updated_at = @updated_at,
            completed_at = @completed_at
          WHERE request_id = @request_id
        `,
      )
      .run({
        request_id: input.request.requestId,
        summary: input.message,
        error_message: input.message,
        session_mode: input.sessionMode ?? null,
        codex_thread_id: input.threadId ?? null,
        updated_at: completedAt,
        completed_at: completedAt,
      });
  }

  getTurn(requestId: string): StoredTaskTurnRecord | null {
    const normalized = requestId.trim();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT *
          FROM themis_turns
          WHERE request_id = ?
        `,
      )
      .get(normalized) as TurnRow | undefined;

    return row ? mapTurnRow(row) : null;
  }

  listTurnEvents(requestId: string): StoredTaskEventRecord[] {
    const normalized = requestId.trim();

    if (!normalized) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT event_id, request_id, task_id, event_type, status, message, payload_json, created_at
          FROM themis_turn_events
          WHERE request_id = ?
          ORDER BY created_at ASC, event_id ASC
        `,
      )
      .all(normalized) as EventRow[];

    return rows.map(mapEventRow);
  }

  listTurnFiles(requestId: string): string[] {
    const normalized = requestId.trim();

    if (!normalized) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT file_path
          FROM themis_turn_files
          WHERE request_id = ?
          ORDER BY file_path ASC
        `,
      )
      .all(normalized) as Array<{ file_path: string }>;

    return rows.map((row) => row.file_path);
  }

  listSessionTurns(sessionId: string): StoredTaskTurnRecord[] {
    const normalized = sessionId.trim();

    if (!normalized) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM themis_turns
          WHERE session_id = ?
          ORDER BY created_at ASC, request_id ASC
        `,
      )
      .all(normalized) as TurnRow[];

    return rows.map(mapTurnRow);
  }

  listRecentSessions(limit = 24): StoredSessionHistorySummary[] {
    const resolvedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 24;
    const rows = this.db
      .prepare(
        `
          SELECT
            grouped.session_id,
            grouped.created_at,
            grouped.updated_at,
            grouped.turn_count,
            COALESCE(NULLIF(cs.thread_id, ''), latest.codex_thread_id) AS thread_id,
            latest.request_id AS latest_request_id,
            latest.task_id AS latest_task_id,
            latest.workflow AS latest_workflow,
            latest.role AS latest_role,
            latest.goal AS latest_goal,
            latest.status AS latest_status,
            latest.summary AS latest_summary,
            latest.session_mode AS latest_session_mode,
            latest.codex_thread_id AS latest_codex_thread_id,
            latest.updated_at AS latest_updated_at
          FROM (
            SELECT
              session_id,
              MIN(created_at) AS created_at,
              MAX(updated_at) AS updated_at,
              COUNT(*) AS turn_count
            FROM themis_turns
            WHERE session_id IS NOT NULL AND session_id <> ''
            GROUP BY session_id
          ) grouped
          INNER JOIN themis_turns latest
            ON latest.request_id = (
              SELECT request_id
              FROM themis_turns latest_turn
              WHERE latest_turn.session_id = grouped.session_id
              ORDER BY latest_turn.updated_at DESC, latest_turn.created_at DESC, latest_turn.request_id DESC
              LIMIT 1
            )
          LEFT JOIN codex_sessions cs
            ON cs.session_id = grouped.session_id
          ORDER BY grouped.updated_at DESC
          LIMIT ?
        `,
      )
      .all(resolvedLimit) as SessionSummaryRow[];

    return rows.map(mapSessionSummaryRow);
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS codex_sessions (
        session_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        active_task_id TEXT
      );

      CREATE INDEX IF NOT EXISTS codex_sessions_updated_at_idx
      ON codex_sessions(updated_at DESC);

      CREATE INDEX IF NOT EXISTS codex_sessions_active_task_id_idx
      ON codex_sessions(active_task_id);

      CREATE TABLE IF NOT EXISTS themis_turns (
        request_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        session_id TEXT,
        source_channel TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_display_name TEXT,
        role TEXT NOT NULL,
        workflow TEXT NOT NULL,
        goal TEXT NOT NULL,
        input_text TEXT,
        history_context TEXT,
        options_json TEXT,
        status TEXT NOT NULL,
        summary TEXT,
        output TEXT,
        error_message TEXT,
        structured_output_json TEXT,
        session_mode TEXT,
        codex_thread_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS themis_turns_task_id_idx
      ON themis_turns(task_id);

      CREATE INDEX IF NOT EXISTS themis_turns_session_id_idx
      ON themis_turns(session_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS themis_turns_updated_at_idx
      ON themis_turns(updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_turn_events (
        event_id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (request_id) REFERENCES themis_turns(request_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_turn_events_request_id_idx
      ON themis_turn_events(request_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS themis_turn_files (
        request_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (request_id, file_path),
        FOREIGN KEY (request_id) REFERENCES themis_turns(request_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_turn_files_task_id_idx
      ON themis_turn_files(task_id);
    `);
  }

  private countSessions(): number {
    const row = this.db
      .prepare(
        `
          SELECT COUNT(*) AS total
          FROM codex_sessions
        `,
      )
      .get() as { total: number };

    return row.total;
  }

  private migrateLegacyRegistryIfNeeded(): void {
    if (this.countSessions() > 0 || !existsSync(this.legacyRegistryFile)) {
      return;
    }

    let parsed: LegacyPersistedSessionRegistry;

    try {
      parsed = JSON.parse(readFileSync(this.legacyRegistryFile, "utf8")) as LegacyPersistedSessionRegistry;
    } catch {
      return;
    }

    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.sessions)) {
      return;
    }

    const migrateSessions = this.db.transaction((sessions: LegacyPersistedSessionRecord[]) => {
      for (const session of sessions) {
        if (!session.sessionId || !session.threadId) {
          continue;
        }

        this.saveSession({
          sessionId: session.sessionId,
          threadId: session.threadId,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        });
      }
    });

    migrateSessions(parsed.sessions);
  }
}

function mapSessionRow(row: SessionRow): StoredCodexSessionRecord {
  return {
    sessionId: row.session_id,
    threadId: row.thread_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.active_task_id ? { activeTaskId: row.active_task_id } : {}),
  };
}

function mapTurnRow(row: TurnRow): StoredTaskTurnRecord {
  return {
    requestId: row.request_id,
    taskId: row.task_id,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    sourceChannel: row.source_channel,
    userId: row.user_id,
    ...(row.user_display_name ? { userDisplayName: row.user_display_name } : {}),
    role: row.role,
    workflow: row.workflow,
    goal: row.goal,
    ...(row.input_text ? { inputText: row.input_text } : {}),
    ...(row.history_context ? { historyContext: row.history_context } : {}),
    ...(row.options_json ? { optionsJson: row.options_json } : {}),
    status: row.status,
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.output ? { output: row.output } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    ...(row.structured_output_json ? { structuredOutputJson: row.structured_output_json } : {}),
    ...(row.session_mode ? { sessionMode: row.session_mode } : {}),
    ...(row.codex_thread_id ? { codexThreadId: row.codex_thread_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

function mapEventRow(row: EventRow): StoredTaskEventRecord {
  return {
    eventId: row.event_id,
    requestId: row.request_id,
    taskId: row.task_id,
    type: row.event_type,
    status: row.status,
    ...(row.message ? { message: row.message } : {}),
    ...(row.payload_json ? { payloadJson: row.payload_json } : {}),
    createdAt: row.created_at,
  };
}

function mapSessionSummaryRow(row: SessionSummaryRow): StoredSessionHistorySummary {
  const threadId = normalizeText(row.thread_id ?? undefined);

  return {
    sessionId: row.session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    turnCount: row.turn_count,
    ...(threadId ? { threadId } : {}),
    latestTurn: {
      requestId: row.latest_request_id,
      taskId: row.latest_task_id,
      workflow: row.latest_workflow,
      role: row.latest_role,
      goal: row.latest_goal,
      status: row.latest_status,
      ...(row.latest_summary ? { summary: row.latest_summary } : {}),
      ...(row.latest_session_mode ? { sessionMode: row.latest_session_mode } : {}),
      ...(row.latest_codex_thread_id ? { codexThreadId: row.latest_codex_thread_id } : {}),
      updatedAt: row.latest_updated_at,
    },
  };
}

function extractSessionMetadata(
  payload: Record<string, unknown> | undefined,
): {
  sessionMode?: string;
  threadId?: string;
} {
  const directPayload = asRecord(payload);
  const sessionPayload = asRecord(directPayload?.session) ?? directPayload;
  const sessionMode = normalizeText(
    typeof sessionPayload?.sessionMode === "string"
      ? sessionPayload.sessionMode
      : typeof sessionPayload?.mode === "string"
        ? sessionPayload.mode
        : undefined,
  );
  const threadId = normalizeText(typeof sessionPayload?.threadId === "string" ? sessionPayload.threadId : undefined);

  return {
    ...(sessionMode ? { sessionMode } : {}),
    ...(threadId ? { threadId } : {}),
  };
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function stringifyJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}
