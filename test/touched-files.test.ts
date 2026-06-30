import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { TouchedFileTracker } from "../extensions/pi-brains/touched-files.ts";

function result(toolName: string, path: string, isError = false): ToolResultEvent {
  return {
    type: "tool_result",
    toolCallId: "call-1",
    toolName,
    input: { path },
    content: [],
    details: undefined,
    isError,
  } as ToolResultEvent;
}

describe("touched file tracking", () => {
  it("tracks successful structured tools once", () => {
    const tracker = new TouchedFileTracker();
    expect(tracker.recordResult(result("read", "src/a.ts"), "/repo")).toBe(true);
    expect(tracker.recordResult(result("read", "src/a.ts"), "/repo")).toBe(false);
    expect(tracker.recordResult(result("write", "src/b.ts", true), "/repo")).toBe(false);
    expect([...tracker.getFiles()]).toEqual(["/repo/src/a.ts"]);
  });

  it("marks shell coverage as incomplete without inventing paths", () => {
    const tracker = new TouchedFileTracker();
    tracker.recordResult(result("bash", "ignored"), "/repo");
    expect(tracker.hasShellActivity()).toBe(true);
    expect(tracker.getFiles().size).toBe(0);
  });

  it("replays successful tool calls from the active branch", () => {
    const tracker = new TouchedFileTracker();
    tracker.replay(
      [
        {
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "call-1", name: "edit", arguments: { path: "src/a.ts" } }],
          },
        },
        {
          type: "message",
          message: { role: "toolResult", toolCallId: "call-1", isError: false },
        },
      ],
      "/repo",
    );
    expect([...tracker.getFiles()]).toEqual(["/repo/src/a.ts"]);
  });
});
