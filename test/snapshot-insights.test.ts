import { describe, expect, it } from "vitest";
import { collectSnapshotInsightActivity } from "../extensions/pi-brains/snapshot-insights.ts";

function toolCallEntry(id: string, calls: Array<{ id: string; name: string; path?: string }>) {
  return {
    id,
    type: "message",
    message: {
      role: "assistant",
      content: calls.map(call => ({
        type: "toolCall",
        id: call.id,
        name: call.name,
        arguments: call.path ? { path: call.path } : { command: "npm test" },
      })),
    },
  };
}

function toolResultEntry(id: string, toolCallId: string, isError = false) {
  return {
    id,
    type: "message",
    message: { role: "toolResult", toolCallId, isError },
  };
}

describe("snapshot insight activity", () => {
  it("counts successful direct mutations after the snapshot boundary", () => {
    const entries = [
      toolCallEntry("before", [{ id: "read-1", name: "read", path: "src/a.ts" }]),
      toolResultEntry("before-result", "read-1"),
      { id: "snapshot-leaf", type: "message", message: { role: "user", content: "snapshot" } },
      toolCallEntry("after", [
        { id: "edit-1", name: "edit", path: "src/a.ts" },
        { id: "write-1", name: "write", path: "src/b.ts" },
      ]),
      toolResultEntry("edit-result", "edit-1"),
      toolResultEntry("write-result", "write-1", true),
    ];

    expect(collectSnapshotInsightActivity(entries, "/repo", "snapshot-leaf")).toEqual({
      recognizedFiles: ["/repo/src/a.ts", "/repo/src/b.ts"],
      directMutationFiles: ["/repo/src/a.ts"],
      shellActivity: false,
      boundaryOnActiveBranch: true,
    });
  });

  it("reports shell uncertainty without inventing paths", () => {
    const entries = [
      toolCallEntry("bash-call", [{ id: "bash-1", name: "bash" }]),
      toolResultEntry("bash-result", "bash-1"),
    ];

    expect(collectSnapshotInsightActivity(entries, "/repo", null)).toEqual({
      recognizedFiles: [],
      directMutationFiles: [],
      shellActivity: true,
      boundaryOnActiveBranch: true,
    });
  });

  it("includes a pending pre-execution mutation and flags a diverged boundary", () => {
    const activity = collectSnapshotInsightActivity(
      [],
      "/repo",
      "snapshot-on-another-branch",
      { toolName: "write", path: "src/new.ts" },
    );

    expect(activity).toEqual({
      recognizedFiles: ["/repo/src/new.ts"],
      directMutationFiles: ["/repo/src/new.ts"],
      shellActivity: false,
      boundaryOnActiveBranch: false,
    });
  });
});
