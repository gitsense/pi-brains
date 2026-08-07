import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_HEARTBEAT_INTERVAL_MS, getAliveHeartbeatSessionIds, getHeartbeatRecordsForSessions, heartbeatDbPath, startSessionHeartbeat, type HeartbeatSource } from "../extensions/pi-brains/heartbeat.ts";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION_ID = "22222222-2222-4222-8222-222222222222";

function withTempStore(): { dbPath: string; restore: () => void } {
  const previous = process.env.GSC_HOME;
  const home = mkdtempSync(join(tmpdir(), "pi-brains-heartbeat-test-"));
  process.env.GSC_HOME = home;
  return {
    dbPath: heartbeatDbPath(),
    restore: () => {
      process.env.GSC_HOME = previous;
      rmSync(home, { recursive: true, force: true });
    },
  };
}

function createSource(sessionId: string | null = SESSION_ID): HeartbeatSource {
  return { getSessionId: () => sessionId };
}

describe("pi session heartbeat store", () => {
  it("upserts an initial alive heartbeat immediately with session metadata", () => {
    const { dbPath, restore } = withTempStore();
    try {
      const heartbeat = startSessionHeartbeat(createSource(), { mode: "tui", cwd: "/work/demo" }, { dbPath });

      const records = getHeartbeatRecordsForSessions(dbPath, [SESSION_ID]);
      expect(records).toHaveLength(1);
      const record = records[0];
      expect(record.session_id).toBe(SESSION_ID);
      expect(record.pid).toBe(process.pid);
      expect(record.cwd).toBe("/work/demo");
      expect(record.status).toBe("alive");
      expect(record.started_at).toBeGreaterThan(0);
      expect(record.last_heartbeat_at).toBeGreaterThan(0);

      heartbeat.stop();
    } finally {
      restore();
    }
  });

  it("refreshes last_heartbeat_at on the configured interval", async () => {
    vi.useFakeTimers();
    try {
      const { dbPath, restore } = withTempStore();
      const heartbeat = startSessionHeartbeat(createSource(), { mode: "tui", cwd: "/work/demo" }, { dbPath, intervalMs: 100 });

      const first = getHeartbeatRecordsForSessions(dbPath, [SESSION_ID])[0]!.last_heartbeat_at;
      await vi.advanceTimersByTimeAsync(100);
      const second = getHeartbeatRecordsForSessions(dbPath, [SESSION_ID])[0]!.last_heartbeat_at;
      await vi.advanceTimersByTimeAsync(100);
      const third = getHeartbeatRecordsForSessions(dbPath, [SESSION_ID])[0]!.last_heartbeat_at;

      expect(second).toBeGreaterThan(first);
      expect(third).toBeGreaterThan(second);

      heartbeat.stop();
      restore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop() marks the row stopped and stops further writes", async () => {
    vi.useFakeTimers();
    try {
      const { dbPath, restore } = withTempStore();
      const heartbeat = startSessionHeartbeat(createSource(), { mode: "tui", cwd: "/work/demo" }, { dbPath, intervalMs: 100 });

      heartbeat.stop();
      expect(getHeartbeatRecordsForSessions(dbPath, [SESSION_ID])[0]!.status).toBe("stopped");

      const last = getHeartbeatRecordsForSessions(dbPath, [SESSION_ID])[0]!.last_heartbeat_at;
      await vi.advanceTimersByTimeAsync(300);
      expect(getHeartbeatRecordsForSessions(dbPath, [SESSION_ID])[0]!.last_heartbeat_at).toBe(last);

      restore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports only alive sessions within the window and excludes stopped ones", async () => {
    const { dbPath, restore } = withTempStore();
    try {
      const first = startSessionHeartbeat(createSource(SESSION_ID), { mode: "tui", cwd: "/work/a" }, { dbPath });
      const second = startSessionHeartbeat(createSource(OTHER_SESSION_ID), { mode: "tui", cwd: "/work/b" }, { dbPath });
      second.stop();

      const alive = getAliveHeartbeatSessionIds(dbPath, 30_000);
      expect(alive).toContain(SESSION_ID);
      expect(alive).not.toContain(OTHER_SESSION_ID);

      first.stop();
    } finally {
      restore();
    }
  });

  it("returns an empty alive set when the store does not exist", () => {
    const { dbPath, restore } = withTempStore();
    try {
      expect(getAliveHeartbeatSessionIds(dbPath, 30_000)).toEqual([]);
      expect(getHeartbeatRecordsForSessions(dbPath, [SESSION_ID])).toEqual([]);
    } finally {
      restore();
    }
  });

  it("is a no-op outside the TUI", () => {
    const { dbPath, restore } = withTempStore();
    try {
      const heartbeat = startSessionHeartbeat(createSource(), { mode: "print", cwd: "/work/demo" }, { dbPath });
      expect(getHeartbeatRecordsForSessions(dbPath, [SESSION_ID])).toEqual([]);
      heartbeat.stop();
    } finally {
      restore();
    }
  });

  it("skips writes until a session id exists", async () => {
    vi.useFakeTimers();
    try {
      const { dbPath, restore } = withTempStore();
      let sessionId: string | null = null;
      const source: HeartbeatSource = { getSessionId: () => sessionId };
      const heartbeat = startSessionHeartbeat(source, { mode: "tui", cwd: "/work/demo" }, { dbPath, intervalMs: 100 });
      expect(getHeartbeatRecordsForSessions(dbPath, [SESSION_ID])).toEqual([]);

      sessionId = SESSION_ID;
      await vi.advanceTimersByTimeAsync(100);
      expect(getHeartbeatRecordsForSessions(dbPath, [SESSION_ID])[0]!.status).toBe("alive");

      heartbeat.stop();
      restore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("prunes rows idle for longer than the retention window", async () => {
    const { dbPath, restore } = withTempStore();
    try {
      const heartbeat = startSessionHeartbeat(createSource(), { mode: "tui", cwd: "/work/demo" }, { dbPath });
      // Rewrite the row with a stale timestamp, then a fresh beat for a second
      // session triggers the prune on write.
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(dbPath);
      db.prepare("UPDATE heartbeats SET last_heartbeat_at = ? WHERE session_id = ?").run(Date.now() - 31 * 24 * 60 * 60 * 1_000, SESSION_ID);
      db.close();

      const other = startSessionHeartbeat(createSource(OTHER_SESSION_ID), { mode: "tui", cwd: "/work/b" }, { dbPath });
      expect(getHeartbeatRecordsForSessions(dbPath, [SESSION_ID])).toEqual([]);
      expect(getHeartbeatRecordsForSessions(dbPath, [OTHER_SESSION_ID])).toHaveLength(1);

      other.stop();
      heartbeat.stop();
    } finally {
      restore();
    }
  });

  it("uses the default 15s interval constant", () => {
    expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBe(15_000);
  });
});
