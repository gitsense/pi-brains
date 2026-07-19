import { describe, expect, it } from "vitest";
import { getActiveContextItems, hasGitSenseGuidance } from "../extensions/pi-brains/guidance-context.ts";

function initCall(id = "call-1") {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name: "bash", arguments: { command: "gsc experts init" } }],
  };
}

describe("GitSense guidance context detection", () => {
  it("requires a successful init tool result in active context", () => {
    expect(hasGitSenseGuidance([
      initCall(),
      { role: "toolResult", toolCallId: "call-1", isError: false },
    ])).toBe(true);
    expect(hasGitSenseGuidance([initCall()])).toBe(false);
    expect(hasGitSenseGuidance([
      initCall(),
      { role: "toolResult", toolCallId: "call-1", isError: true },
    ])).toBe(false);
  });

  it("recognizes a compaction summary that records completed initialization", () => {
    expect(hasGitSenseGuidance([{
      role: "compactionSummary",
      summary: "Ran gsc experts init and loaded the GitSense guidance before implementation.",
    }])).toBe(true);
  });

  it("does not treat a future initialization instruction as loaded guidance", () => {
    expect(hasGitSenseGuidance([{
      type: "compaction",
      summary: "Next step: run gsc experts init before changing the rules.",
    }])).toBe(false);
  });

  it("supports compaction-aware session entries", () => {
    expect(hasGitSenseGuidance([
      { type: "message", message: initCall("entry-call") },
      {
        type: "message",
        message: { role: "toolResult", toolCallId: "entry-call", isError: false },
      },
    ])).toBe(true);
  });

  it("drops pre-compaction history when the session manager lacks the newer helper", () => {
    const active = getActiveContextItems({
      getBranch: () => [
        { type: "message", id: "old-call", message: initCall("old-init") },
        { type: "message", id: "old-result", message: { role: "toolResult", toolCallId: "old-init", isError: false } },
        { type: "message", id: "kept", message: { role: "user", content: "keep" } },
        { type: "compaction", id: "compact", firstKeptEntryId: "kept", summary: "Work was compacted." },
        { type: "message", id: "new", message: { role: "assistant", content: [] } },
      ],
    });

    expect(hasGitSenseGuidance(active)).toBe(false);
    expect(active).toHaveLength(3);
  });
});
