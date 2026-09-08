import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/pi-brains/config.ts";
import { PiBrainsController } from "../extensions/pi-brains/controller.ts";

function createPi() {
  return {
    exec: vi.fn(async (command: string) => command === "gsc"
      ? { code: 0, stdout: "[]", stderr: "", killed: false }
      : { code: 1, stdout: "", stderr: "", killed: false }),
    getThinkingLevel: () => "off",
    getCommands: () => [],
    getActiveTools: () => [],
    getAllTools: () => [],
    getSessionName: () => undefined,
    on: vi.fn(),
  } as unknown as ExtensionAPI;
}

function createContext(choice = "Continue without snapshot") {
  const select = vi.fn(async (_message: string, _choices: string[]) => choice);
  const notify = vi.fn();
  const abort = vi.fn();
  const ctx = {
    cwd: "/repo",
    hasUI: true,
    abort,
    sessionManager: {
      getSessionId: () => "session-1",
      getSessionFile: () => "/repo/session.jsonl",
      getLeafId: () => "leaf-1",
      getBranch: () => [],
    },
    ui: { select, notify },
  } as unknown as ExtensionContext;
  return { ctx, select, notify, abort };
}

function toolCall(toolName: string, input: Record<string, unknown>): ToolCallEvent {
  return {
    type: "tool_call",
    toolCallId: `call-${toolName}`,
    toolName,
    input,
  } as ToolCallEvent;
}

describe("snapshot insight lifecycle", () => {
  it("shows one pre-execution notice for the first direct mutation when enabled", async () => {
    const pi = createPi();
    const controller = new PiBrainsController(pi, {
      ...DEFAULT_CONFIG,
      rulesEnabled: false,
      snapshotInsightSessionIds: ["session-1"],
    });
    const { ctx, select } = createContext();

    await controller.handleToolCall(toolCall("edit", { path: "src/a.ts" }), ctx);
    await controller.handleToolCall(toolCall("write", { path: "src/b.ts" }), ctx);

    expect(select).toHaveBeenCalledTimes(1);
    expect(select.mock.calls[0]?.[0]).toContain("First direct mutation is about to run: edit src/a.ts");
    expect(select.mock.calls[0]?.[0]).toContain("Baseline: none");
  });

  it("shows a new notice after a snapshot resets the insight boundary", async () => {
    const controller = new PiBrainsController(createPi(), {
      ...DEFAULT_CONFIG,
      rulesEnabled: false,
      snapshotInsightSessionIds: ["session-1"],
    });
    const { ctx, select } = createContext();

    await controller.handleToolCall(toolCall("edit", { path: "src/a.ts" }), ctx);
    controller.resetSnapshotInsightBoundary("leaf-1", "snap-1");
    await controller.handleToolCall(toolCall("write", { path: "src/b.ts" }), ctx);

    expect(select).toHaveBeenCalledTimes(2);
  });

  it("produces no snapshot notice while insights are off", async () => {
    const controller = new PiBrainsController(createPi(), { ...DEFAULT_CONFIG, rulesEnabled: false });
    const { ctx, select } = createContext();

    await controller.handleToolCall(toolCall("edit", { path: "src/a.ts" }), ctx);

    expect(select).not.toHaveBeenCalled();
  });

  it("blocks the pending mutation when the user pauses for review", async () => {
    const controller = new PiBrainsController(createPi(), {
      ...DEFAULT_CONFIG,
      rulesEnabled: false,
      snapshotInsightSessionIds: ["session-1"],
    });
    const { ctx, abort } = createContext("Pause and run /brains snapshots review");

    const result = await controller.handleToolCall(toolCall("edit", { path: "src/a.ts" }), ctx);

    expect(abort).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      block: true,
      reason: "User paused the first mutation for snapshot review. Run /brains snapshots review, then retry.",
    });
  });

  it("fails safe when the first-mutation prompt is dismissed", async () => {
    const controller = new PiBrainsController(createPi(), {
      ...DEFAULT_CONFIG,
      rulesEnabled: false,
      snapshotInsightSessionIds: ["session-1"],
    });
    const { ctx, abort } = createContext("");

    const result = await controller.handleToolCall(toolCall("edit", { path: "src/a.ts" }), ctx);

    expect(abort).toHaveBeenCalledTimes(1);
    expect(result?.block).toBe(true);
  });

  it("warns once that shell file effects may be incomplete", async () => {
    const controller = new PiBrainsController(createPi(), {
      ...DEFAULT_CONFIG,
      rulesEnabled: false,
      snapshotInsightSessionIds: ["session-1"],
    });
    const { ctx, notify } = createContext();

    await controller.handleToolCall(toolCall("bash", { command: "npm test" }), ctx);
    await controller.handleToolCall(toolCall("bash", { command: "npm run check" }), ctx);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("file effects may not be fully observable"), "warning");
  });
});
