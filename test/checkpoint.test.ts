import { describe, expect, it } from "vitest";
import {
  buildCheckpointGuideArgs,
  buildCheckpointVerifyArgs,
  loadCheckpointGuide,
  verifyCheckpoint,
  type CheckpointCommandRunner,
  type CheckpointIdentity,
} from "../extensions/pi-brains/checkpoint.ts";

const identity: CheckpointIdentity = {
  checkpointId: "chk-controller-1",
  sessionId: "pi-session-1",
  agent: "pi",
  nativeSessionId: "pi-session-1",
  entryId: "entry-1",
  anchorLeafId: "leaf-1",
  repoPath: "/repo with spaces",
};

function guidePayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: 1,
    identity: {
      checkpoint_id: identity.checkpointId,
      session_id: identity.sessionId,
      agent: identity.agent,
      native_session_id: identity.nativeSessionId,
      entry_id: identity.entryId,
      anchor_leaf_id: identity.anchorLeafId,
    },
    instructions: "Canonical checkpoint instructions",
    ...overrides,
  });
}

function verificationPayload(fileChanges: unknown = []): string {
  return JSON.stringify({
    schema_version: 1,
    status: "verified",
    checkpoint_id: identity.checkpointId,
    file_changes_audited: true,
    file_change_count: Array.isArray(fileChanges) ? fileChanges.length : 0,
    checkpoint: {
      checkpointId: identity.checkpointId,
      sessionId: identity.sessionId,
      entryId: identity.entryId,
      source: {
        agent: identity.agent,
        nativeSessionId: identity.nativeSessionId,
        anchorLeafId: identity.anchorLeafId,
      },
      file_changes: fileChanges,
    },
  });
}

describe("canonical checkpoint guide", () => {
  it("passes the controller-issued ID and complete Pi identity to gsc", () => {
    expect(buildCheckpointGuideArgs(identity)).toEqual([
      "sessions", "checkpoints", "guide",
      "--checkpoint-id", "chk-controller-1",
      "--session", "pi-session-1",
      "--agent", "pi",
      "--native-session", "pi-session-1",
      "--entry-id", "entry-1",
      "--anchor-leaf", "leaf-1",
      "--repo", "/repo with spaces",
      "--format", "json",
    ]);
  });

  it("loads the shared guide instead of building embedded instructions", async () => {
    let invocation: { command: string; args: string[]; cwd: string } | null = null;
    const runner: CheckpointCommandRunner = async (command, args, cwd) => {
      invocation = { command, args, cwd };
      return { ok: true, stdout: guidePayload(), stderr: "" };
    };
    await expect(loadCheckpointGuide(identity, "/repo with spaces", runner))
      .resolves.toBe("Canonical checkpoint instructions");
    expect(invocation).toEqual({ command: "gsc", args: buildCheckpointGuideArgs(identity), cwd: "/repo with spaces" });
  });

  it("rejects a guide that replaces the controller identity", async () => {
    const runner: CheckpointCommandRunner = async () => ({
      ok: true,
      stdout: guidePayload({ identity: { checkpoint_id: "chk-other" } }),
      stderr: "",
    });
    await expect(loadCheckpointGuide(identity, "/repo", runner)).rejects.toThrow("resolved identity mismatch");
  });
});

describe("persisted checkpoint verification", () => {
  it("uses the canonical verifier and accepts an explicit empty file audit", async () => {
    expect(buildCheckpointVerifyArgs(identity)).toEqual([
      "sessions", "checkpoints", "verify", "chk-controller-1",
      "--session", "pi-session-1",
      "--agent", "pi",
      "--native-session", "pi-session-1",
      "--entry-id", "entry-1",
      "--anchor-leaf", "leaf-1",
      "--format", "json",
    ]);
    const runner: CheckpointCommandRunner = async () => ({ ok: true, stdout: verificationPayload([]), stderr: "" });
    await expect(verifyCheckpoint(identity, "/repo", runner)).resolves.toBeUndefined();
  });

  it("fails when persisted file_changes is omitted", async () => {
    const payload = JSON.parse(verificationPayload());
    delete payload.checkpoint.file_changes;
    const runner: CheckpointCommandRunner = async () => ({ ok: true, stdout: JSON.stringify(payload), stderr: "" });
    await expect(verifyCheckpoint(identity, "/repo", runner)).rejects.toThrow("file audit mismatch");
  });

  it("preserves bash, secondary-repository, and tmp changes in the verified payload", async () => {
    const changes = [
      { path: "generated.ts", repository: "pi-brains", method: "bash", change: "created" },
      { path: "checkpoint.txt", repository: "tmp", method: "write", change: "created" },
    ];
    const runner: CheckpointCommandRunner = async () => ({ ok: true, stdout: verificationPayload(changes), stderr: "" });
    await expect(verifyCheckpoint(identity, "/repo", runner)).resolves.toBeUndefined();
  });
});
