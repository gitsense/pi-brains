import { DatabaseSync, type StatementSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveGscHome } from "./inbox.ts";

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_PRUNE_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

export interface SessionHeartbeatHandle {
  refresh(): void;
  stop(): void;
}

export type HeartbeatRuntime = "tmux" | "terminal";

export interface SessionHeartbeatOptions {
  /** Heartbeat period in ms. Defaults to DEFAULT_HEARTBEAT_INTERVAL_MS. */
  intervalMs?: number;
  /** Override the heartbeat store path (tests). Defaults to the gsc store path. */
  dbPath?: string;
  /** Current Chat inbox auto-accept state, read again on every heartbeat. */
  getAutoAcceptEnabled?: () => boolean;
  /** Override runtime detection (tests). */
  runtime?: HeartbeatRuntime;
}

export interface HeartbeatSource {
  getSessionId(): string | null;
}

export interface HeartbeatRecord {
  session_id: string;
  pid: number;
  cwd: string;
  started_at: number;
  status: "alive" | "stopped";
  last_heartbeat_at: number;
  runtime: HeartbeatRuntime;
  auto_accept: boolean;
}

const UPSERT_SQL = `
  INSERT INTO heartbeats (session_id, pid, cwd, started_at, status, last_heartbeat_at, runtime, auto_accept)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(session_id) DO UPDATE SET
    pid = excluded.pid,
    cwd = excluded.cwd,
    started_at = excluded.started_at,
    status = excluded.status,
    last_heartbeat_at = excluded.last_heartbeat_at,
    runtime = excluded.runtime,
    auto_accept = excluded.auto_accept
`;

const MARK_STOPPED_SQL = `
  UPDATE heartbeats SET status = ?, last_heartbeat_at = ? WHERE session_id = ?
`;

const PRUNE_SQL = `DELETE FROM heartbeats WHERE last_heartbeat_at < ?`;

const SELECT_COLUMNS = "session_id, pid, cwd, started_at, status, last_heartbeat_at, runtime, auto_accept";

export function detectHeartbeatRuntime(env: NodeJS.ProcessEnv = process.env): HeartbeatRuntime {
  return env.TMUX && env.TMUX.trim() !== "" ? "tmux" : "terminal";
}

/**
 * Canonical shared heartbeat store, next to gsc's pi-sessions.sqlite3 mirror.
 * Every pi session with pi-brains loaded upserts its own row, so GitSense
 * Chat can answer "which sessions were alive in the last N seconds" and
 * cross-reference a set of session ids with a single indexed query instead
 * of scanning per-session files.
 */
export function heartbeatDbPath(): string {
  const { gscHome } = resolveGscHome();
  return join(gscHome, "data", "pi", "pi-heartbeats.sqlite3");
}

interface OpenHeartbeatStore {
  db: DatabaseSync;
  upsert: StatementSync;
  markStopped: StatementSync;
  prune: StatementSync;
}

function openHeartbeatStore(dbPath: string): OpenHeartbeatStore {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath, { timeout: 5_000 });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS heartbeats (
      session_id TEXT PRIMARY KEY,
      pid INTEGER NOT NULL,
      cwd TEXT NOT NULL DEFAULT '',
      started_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'alive',
      last_heartbeat_at INTEGER NOT NULL,
      runtime TEXT NOT NULL DEFAULT 'terminal',
      auto_accept INTEGER NOT NULL DEFAULT 0
    )
  `);
  // CREATE TABLE IF NOT EXISTS does not add columns to an existing v1 store.
  // Migrate in place so current installations retain their heartbeat history.
  const columns = new Set(
    db.prepare("PRAGMA table_info(heartbeats)").all().flatMap((row) => {
      const name = (row as Record<string, unknown>).name;
      return typeof name === "string" ? [name] : [];
    }),
  );
  if (!columns.has("runtime")) {
    db.exec("ALTER TABLE heartbeats ADD COLUMN runtime TEXT NOT NULL DEFAULT 'terminal'");
  }
  if (!columns.has("auto_accept")) {
    db.exec("ALTER TABLE heartbeats ADD COLUMN auto_accept INTEGER NOT NULL DEFAULT 0");
  }
  db.exec("PRAGMA user_version = 2");
  db.exec("CREATE INDEX IF NOT EXISTS heartbeats_liveness ON heartbeats(status, last_heartbeat_at)");
  return {
    db,
    upsert: db.prepare(UPSERT_SQL),
    markStopped: db.prepare(MARK_STOPPED_SQL),
    prune: db.prepare(PRUNE_SQL),
  };
}

function toRecord(row: unknown): HeartbeatRecord | null {
  if (typeof row !== "object" || row === null) return null;
  const value = row as Record<string, unknown>;
  if (typeof value.session_id !== "string" || typeof value.last_heartbeat_at !== "number") return null;
  return {
    session_id: value.session_id,
    pid: typeof value.pid === "number" ? value.pid : 0,
    cwd: typeof value.cwd === "string" ? value.cwd : "",
    started_at: typeof value.started_at === "number" ? value.started_at : 0,
    status: value.status === "stopped" ? "stopped" : "alive",
    last_heartbeat_at: value.last_heartbeat_at,
    runtime: value.runtime === "tmux" ? "tmux" : "terminal",
    auto_accept: value.auto_accept === 1,
  };
}

/**
 * Sessions with an alive heartbeat within the last `withinMs` — the
 * "what is running right now" query GitSense Chat uses to decide whether a
 * session can be messaged or needs to be launched.
 */
export function getAliveHeartbeatSessionIds(dbPath: string, withinMs: number): string[] {
  if (!existsSync(dbPath)) return [];
  const store = openHeartbeatStore(dbPath);
  try {
    const since = Date.now() - withinMs;
    const rows = store.db
      .prepare(`SELECT session_id FROM heartbeats WHERE status = 'alive' AND last_heartbeat_at >= ?`)
      .all(since);
    return rows.flatMap((row) => {
      const value = row as Record<string, unknown>;
      return typeof value.session_id === "string" ? [value.session_id] : [];
    });
  } finally {
    store.db.close();
  }
}

/**
 * Heartbeat rows for an explicit set of session ids — the cross-reference
 * query for a chat group or a pinned session list.
 */
export function getHeartbeatRecordsForSessions(dbPath: string, sessionIds: string[]): HeartbeatRecord[] {
  if (sessionIds.length === 0 || !existsSync(dbPath)) return [];
  const store = openHeartbeatStore(dbPath);
  try {
    const placeholders = sessionIds.map(() => "?").join(", ");
    const rows = store.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM heartbeats WHERE session_id IN (${placeholders})`)
      .all(...sessionIds);
    return rows.flatMap((row) => {
      const record = toRecord(row);
      return record ? [record] : [];
    });
  } finally {
    store.db.close();
  }
}

/**
 * Advertise session liveness while the extension is loaded: upsert the
 * session's row immediately, then every `intervalMs` until `stop()` is
 * called. Rows idle for more than HEARTBEAT_PRUNE_AGE_MS are pruned on each
 * write so the store does not grow without bound.
 */
export function startSessionHeartbeat(
  source: HeartbeatSource,
  ctx: { mode: string; cwd: string },
  options: SessionHeartbeatOptions = {},
): SessionHeartbeatHandle {
  // Mirror the inbox watcher: only interactive sessions are addressable from
  // GitSense Chat, so only they advertise liveness.
  if (ctx.mode !== "tui") {
    return { refresh() {}, stop() {} };
  }

  const intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const dbPath = options.dbPath ?? heartbeatDbPath();
  const startedAt = Date.now();
  const runtime = options.runtime ?? detectHeartbeatRuntime();
  let store: OpenHeartbeatStore | null = null;
  let storeFailed = false;
  let timer: NodeJS.Timeout | null = null;

  const write = (status: "alive" | "stopped"): void => {
    const sessionId = source.getSessionId();
    if (!sessionId) return;
    try {
      store ??= openHeartbeatStore(dbPath);
      const now = Date.now();
      const autoAccept = options.getAutoAcceptEnabled?.() ?? false;
      store.upsert.run(sessionId, process.pid, ctx.cwd, startedAt, status, now, runtime, autoAccept ? 1 : 0);
      store.prune.run(now - HEARTBEAT_PRUNE_AGE_MS);
      storeFailed = false;
    } catch {
      // Liveness advertising is best-effort; the next tick retries. Log the
      // first failure only so a broken store is diagnosable without spamming.
      if (!storeFailed) {
        storeFailed = true;
        console.error(`[pi-brains] heartbeat store unavailable at ${dbPath}`);
      }
    }
  };

  write("alive");
  timer = setInterval(() => write("alive"), intervalMs);
  return {
    refresh() {
      write("alive");
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      write("stopped");
      try {
        store?.db.close();
      } catch {
        // Best effort on shutdown.
      }
      store = null;
    },
  };
}
