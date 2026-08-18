import { describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleSnapshotsCommand, type SnapshotCommandController } from "../extensions/pi-brains/snapshots.ts";

function createController(overrides: Partial<SnapshotCommandController> = {}) {
  const controller: SnapshotCommandController = {
    getSessionId: () => "session-1",
    runGscCommand: vi.fn(async () => ({ code: 0, stdout: "[]", stderr: "" })),
    isSnapshotSuggestionsEnabled: () => false,
    setSnapshotSuggestionsEnabled: vi.fn(() => true),
    isSnapshotSuggestionPending: () => false,
    clearSnapshotSuggestion: vi.fn(),
    ...overrides,
  };
  return controller;
}

function createContext(confirm = vi.fn(async () => true)) {
  const notify = vi.fn();
  return {
    ctx: {
      sessionManager: { getLeafId: () => "leaf-1" },
      ui: { notify, confirm },
    } as unknown as ExtensionCommandContext,
    notify,
    confirm,
  };
}

describe("snapshot commands", () => {
  it("enables suggestions for only the current session", async () => {
    const controller = createController();
    const { ctx, notify } = createContext();

    await handleSnapshotsCommand("suggest on", controller, ctx);

    expect(controller.setSnapshotSuggestionsEnabled).toHaveBeenCalledWith(true);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("enabled for this session"), "warning");
  });

  it("creates a snapshot at the trusted current leaf", async () => {
    const runGscCommand = vi.fn(async () => ({
      code: 0,
      stderr: "",
      stdout: JSON.stringify({
        status: "created",
        snapshot_id: "snapshot-1",
        sequence: 2,
        created_at: "2026-08-14T00:00:00Z",
        leaf_id: "leaf-1",
        git_commit: "1234567890abcdef",
        file_count: 3,
        bytes_captured: 2048,
        incomplete: false,
      }),
    }));
    const controller = createController({ runGscCommand });
    const { ctx, notify } = createContext();

    await handleSnapshotsCommand("create", controller, ctx);

    expect(runGscCommand).toHaveBeenCalledWith(
      "pi", "sessions", "snapshots", "create",
      "--session", "session-1",
      "--leaf", "leaf-1",
      "--format", "json",
    );
    expect(controller.clearSnapshotSuggestion).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Snapshot #2 created: 3 files"), "info");
  });

  it("reports an unchanged tree without claiming a new stage", async () => {
    const controller = createController({
      runGscCommand: vi.fn(async () => ({
        code: 0,
        stderr: "",
        stdout: JSON.stringify({ status: "unchanged", unchanged: true, sequence: 4 }),
      })),
    });
    const { ctx, notify } = createContext();

    await handleSnapshotsCommand("create", controller, ctx);

    expect(notify).toHaveBeenCalledWith("No new snapshot: the file tree matches stage #4.", "info");
  });

  it("lists stage, manifest, and Git object locations", async () => {
    const runGscCommand = vi.fn(async () => ({
      code: 0,
      stderr: "",
      stdout: JSON.stringify([{
        snapshot_id: "snap_existing",
        sequence: 4,
        created_at: "2026-08-14T00:00:00Z",
        leaf_id: "leaf-4",
        snapshot_path: "/gsc/snapshots/session-1/snapshots/snap_existing",
        manifest_path: "/gsc/snapshots/session-1/snapshots/snap_existing/manifest.json",
        object_database: "/gsc/snapshots/session-1/objects.git",
        git_commit: "abcdef0123456789abcdef0123456789abcdef01",
        file_count: 3,
        bytes_captured: 2048,
        incomplete: false,
      }]),
    }));
    const controller = createController({ runGscCommand });
    const { ctx, notify } = createContext();

    await handleSnapshotsCommand("list", controller, ctx);

    expect(runGscCommand).toHaveBeenCalledWith(
      "pi", "sessions", "snapshots", "list",
      "--session", "session-1",
      "--format", "json",
    );
    const output = notify.mock.calls[0]?.[0] as string;
    expect(output).toContain("Snapshot Locations");
    expect(output).toContain("/gsc/snapshots/session-1/snapshots/snap_existing/manifest.json");
    expect(output).toContain("/gsc/snapshots/session-1/objects.git");
    expect(output).toContain("abcdef0123456789abcdef0123456789abcdef01");
  });

  it("confirms and recoverably archives snapshots", async () => {
    const runGscCommand = vi
      .fn()
      .mockResolvedValueOnce({
        code: 0,
        stderr: "",
        stdout: JSON.stringify([{ sequence: 1, bytes_captured: 1024 }, { sequence: 2, bytes_captured: 2048 }]),
      })
      .mockResolvedValueOnce({
        code: 0,
        stderr: "",
        stdout: JSON.stringify({
          status: "archived",
          session_id: "session-1",
          snapshot_count: 2,
          bytes_archived: 3072,
          archive_path: "/gsc/snapshot-trash/session-1/archive-1",
        }),
      });
    const controller = createController({ runGscCommand });
    const { ctx, notify, confirm } = createContext();

    await handleSnapshotsCommand("clear", controller, ctx);

    expect(confirm).toHaveBeenCalledWith("Clear session snapshots", expect.stringContaining("recoverable"));
    expect(runGscCommand).toHaveBeenNthCalledWith(
      2,
      "pi", "sessions", "snapshots", "clear",
      "--session", "session-1",
      "--format", "json",
      "--force",
    );
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Recoverable at /gsc/snapshot-trash"), "info");
  });

  it("does not clear when the user cancels", async () => {
    const runGscCommand = vi.fn(async () => ({
      code: 0,
      stderr: "",
      stdout: JSON.stringify([{ sequence: 1, bytes_captured: 10 }]),
    }));
    const controller = createController({ runGscCommand });
    const { ctx, notify } = createContext(vi.fn(async () => false));

    await handleSnapshotsCommand("clear", controller, ctx);

    expect(runGscCommand).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("Snapshot clear cancelled.", "info");
  });
});
