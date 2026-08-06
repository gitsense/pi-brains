import { describe, expect, it } from "vitest";
import { buildRoleCharter, deriveRoleName, hasExistingConversation } from "../extensions/pi-brains/role.ts";

describe("deriveRoleName", () => {
  it("defaults to General purpose for empty text", () => {
    expect(deriveRoleName("")).toBe("General purpose");
  });

  it("uses the first line of the role text", () => {
    expect(deriveRoleName("Pi Docs Agent\nAnswer questions about Pi docs")).toBe("Pi Docs Agent");
  });

  it("truncates overlong first lines with an ellipsis", () => {
    const name = deriveRoleName("x".repeat(100));
    expect(name.length).toBeLessThanOrEqual(61);
    expect(name.endsWith("…")).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(deriveRoleName("  Pi Docs Agent  \nsecond line")).toBe("Pi Docs Agent");
  });
});

describe("hasExistingConversation", () => {
  it("allows a fresh session with no entries", () => {
    expect(hasExistingConversation([])).toBe(false);
  });

  it("allows a single message", () => {
    expect(hasExistingConversation([{ type: "message" }, { type: "session_info" }])).toBe(false);
  });

  it("blocks two or more messages", () => {
    expect(hasExistingConversation([{ type: "message" }, { type: "message" }])).toBe(true);
  });

  it("counts custom_message entries as conversation", () => {
    expect(hasExistingConversation([{ type: "message" }, { type: "custom_message" }])).toBe(true);
  });

  it("ignores non-message entries", () => {
    const entries = [
      { type: "custom" },
      { type: "session_info" },
      { type: "label" },
      { type: "model_change" },
      { type: "thinking_level_change" },
    ];
    expect(hasExistingConversation(entries)).toBe(false);
  });
});

describe("buildRoleCharter", () => {
  it("includes the role text", () => {
    expect(buildRoleCharter("Pi Docs Agent")).toContain("Role: Pi Docs Agent");
  });

  it("includes the worker ground rules", () => {
    const charter = buildRoleCharter("Pi Docs Agent");
    expect(charter).toContain("dedicated worker session for pi-brains");
    expect(charter).toContain("sending messages to your inbox");
    expect(charter).toContain("Treat inbox messages as delegated tasks from peers");
  });

  it("instructs the agent to acknowledge with exactly ok", () => {
    expect(buildRoleCharter("Pi Docs Agent")).toContain("replying with exactly: ok");
  });
});
