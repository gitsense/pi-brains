import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getInboxWatcherStatePath, loadInboxWatcherState, saveInboxWatcherState } from "../extensions/pi-brains/inbox-state.ts";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const previousStateDir = process.env.PI_BRAINS_INBOX_STATE_DIR;

afterEach(() => {
  if (previousStateDir === undefined) {
    delete process.env.PI_BRAINS_INBOX_STATE_DIR;
  } else {
    process.env.PI_BRAINS_INBOX_STATE_DIR = previousStateDir;
  }
});

describe("durable inbox watcher state", () => {
  it("round-trips notification ids and wait-group cursors in a per-session file", async () => {
    process.env.PI_BRAINS_INBOX_STATE_DIR = await mkdtemp(join(tmpdir(), "pi-brains-inbox-state-"));
    await saveInboxWatcherState(SESSION_ID, {
      notifiedAgentMessageIds: ["message-1", "message-1", "message-2"],
      waitGroupCursors: { "group-1": 2 },
    });

    await expect(loadInboxWatcherState(SESSION_ID)).resolves.toEqual({
      notifiedAgentMessageIds: ["message-1", "message-2"],
      waitGroupCursors: { "group-1": 2 },
    });
    expect(JSON.parse(await readFile(getInboxWatcherStatePath(SESSION_ID), "utf8"))).toEqual({
      notifiedAgentMessageIds: ["message-1", "message-2"],
      waitGroupCursors: { "group-1": 2 },
    });
  });

  it("uses legacy config cursors when no session state exists", async () => {
    process.env.PI_BRAINS_INBOX_STATE_DIR = await mkdtemp(join(tmpdir(), "pi-brains-inbox-state-"));
    await expect(loadInboxWatcherState(SESSION_ID, { "legacy-group": 4 })).resolves.toEqual({
      notifiedAgentMessageIds: [],
      waitGroupCursors: { "legacy-group": 4 },
    });
  });
});
