import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getConfigPath } from "./config.ts";

export interface DurableInboxWatcherState {
  /** Message ids, plus message:delivery keys for abandoned lease wake-ups. */
  notifiedAgentMessageIds: string[];
  waitGroupCursors: Record<string, number>;
}

function emptyState(fallbackCursors: Record<string, number> = {}): DurableInboxWatcherState {
  return { notifiedAgentMessageIds: [], waitGroupCursors: { ...fallbackCursors } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseState(value: unknown, fallbackCursors: Record<string, number>): DurableInboxWatcherState {
  if (!isRecord(value)) return emptyState(fallbackCursors);
  const notified = Array.isArray(value.notifiedAgentMessageIds)
    ? value.notifiedAgentMessageIds.filter((item): item is string => typeof item === "string")
    : [];
  const waitGroupCursors: Record<string, number> = { ...fallbackCursors };
  if (isRecord(value.waitGroupCursors)) {
    for (const [groupId, cursor] of Object.entries(value.waitGroupCursors)) {
      if (typeof cursor === "number" && Number.isInteger(cursor) && cursor >= 0) {
        waitGroupCursors[groupId] = cursor;
      }
    }
  }
  return {
    notifiedAgentMessageIds: [...new Set(notified)],
    waitGroupCursors,
  };
}

export function getInboxWatcherStatePath(sessionId: string): string {
  const stateDir = process.env.PI_BRAINS_INBOX_STATE_DIR
    ?? join(dirname(getConfigPath()), "pi-brains-inbox");
  return join(stateDir, `${sessionId}.json`);
}

export async function loadInboxWatcherState(
  sessionId: string,
  fallbackCursors: Record<string, number> = {},
): Promise<DurableInboxWatcherState> {
  try {
    const value: unknown = JSON.parse(await readFile(getInboxWatcherStatePath(sessionId), "utf8"));
    return parseState(value, fallbackCursors);
  } catch {
    return emptyState(fallbackCursors);
  }
}

export async function saveInboxWatcherState(sessionId: string, state: DurableInboxWatcherState): Promise<void> {
  const path = getInboxWatcherStatePath(sessionId);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const normalized = parseState(state, {});
  try {
    await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}
