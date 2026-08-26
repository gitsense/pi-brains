import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach } from "vitest";
import { PiBrainsController } from "../extensions/pi-brains/controller.ts";
import { DEFAULT_CONFIG } from "../extensions/pi-brains/config.ts";
import type { BeforeAgentStartEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PiBrainsConfig } from "../extensions/pi-brains/types.ts";

const PI_WORKSTATE_MARKER = "[PI_WORKSTATE_REQUEST]";

// Helper to create a minimal mock ExtensionAPI
function createMockPi(): any {
  return {
    on: () => {},
    registerTool: () => {},
    registerCommand: () => {},
    registerMessageRenderer: () => {},
    registerEntryRenderer: () => {},
    sendMessage: () => {},
    sendUserMessage: () => {},
    appendEntry: () => {},
    getCommands: () => [],
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => {},
    setModel: async () => true,
    setThinkingLevel: () => {},
    getThinkingLevel: () => "off",
    setSessionName: () => {},
    getSessionName: () => undefined,
    setLabel: () => {},
    registerProvider: () => {},
    unregisterProvider: () => {},
    exec: async () => ({ stdout: "", stderr: "", code: 0 }),
    events: { on: () => {}, emit: () => {} },
  };
}

function createBeforeAgentStartEvent(systemPrompt = "base system prompt"): BeforeAgentStartEvent {
  return {
    type: "before_agent_start",
    prompt: "hard task",
    systemPrompt,
    systemPromptOptions: {
      cwd: "/repo",
      selectedTools: [],
      activeTools: [],
      availableTools: [],
    },
  } as BeforeAgentStartEvent;
}

function createContext(sessionFile = "/repo/session.jsonl"): ExtensionContext {
  return {
    cwd: "/repo",
    getContextUsage: () => null,
    model: null,
    sessionManager: {
      getBranch: () => [],
      getSessionId: () => "session-1",
      getSessionFile: () => sessionFile,
      getLeafId: () => "leaf-1",
    },
    ui: { notify: () => {}, setWidget: () => {} },
  } as unknown as ExtensionContext;
}

describe("guide mode", () => {
  let controller: PiBrainsController;
  let config: PiBrainsConfig;

  beforeEach(() => {
    config = { ...DEFAULT_CONFIG, guideEnabled: false };
    controller = new PiBrainsController(createMockPi(), config);
  });

  describe("debug logging", () => {
    it("logs the initial guide state when the session starts", () => {
      const dir = mkdtempSync(join(tmpdir(), "pi-brains-guide-"));
      try {
        const sessionFile = join(dir, "session.jsonl");
        config.guideEnabled = true;

        controller.start(createContext(sessionFile));

        const logFile = join(dir, "session.checkpoints.jsonl");
        const entries = readFileSync(logFile, "utf8")
          .trim()
          .split("\n")
          .map(line => JSON.parse(line));
        expect(entries[0]).toMatchObject({
          type: "checkpoint_log_initialized",
          guideEnabled: true,
          sessionId: "session-1",
          leafId: "leaf-1",
          logFilePath: logFile,
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("guidance injection", () => {
    it("injects guide instructions into the next agent turn when guide mode is enabled", async () => {
      config.guideEnabled = true;
      config.rulesEnabled = false;

      const result = await controller.handleBeforeAgentStart(createBeforeAgentStartEvent(), createContext());

      expect(result?.systemPrompt).toContain("base system prompt");
      expect(result?.systemPrompt).toContain("Checkpoint suggestions are enabled.");
      expect(result?.systemPrompt).toContain(PI_WORKSTATE_MARKER);
    });

    it("does not inject guide instructions when guide mode is disabled", async () => {
      config.guideEnabled = false;
      config.rulesEnabled = false;

      const result = await controller.handleBeforeAgentStart(createBeforeAgentStartEvent(), createContext());

      expect(result?.systemPrompt).toContain("base system prompt");
      expect(result?.systemPrompt).not.toContain("Checkpoint suggestions are enabled.");
      expect(result?.systemPrompt).not.toContain(PI_WORKSTATE_MARKER);
    });

    it("does not inject legacy snapshot suggestion guidance", async () => {
      config.rulesEnabled = false;

      const result = await controller.handleBeforeAgentStart(createBeforeAgentStartEvent(), createContext());

      expect(result?.systemPrompt).not.toContain("Session snapshot suggestions are enabled.");
    });
  });

  describe("mailbox identity injection (§9)", () => {
    it("injects the mailbox address, trust rule, and guide pointer unconditionally", async () => {
      config.rulesEnabled = false;

      const result = await controller.handleBeforeAgentStart(createBeforeAgentStartEvent(), createContext());

      expect(result?.systemPrompt).toContain("Your mailbox address is session-1");
      expect(result?.systemPrompt).toContain("UNTRUSTED DELEGATED INPUT");
      expect(result?.systemPrompt).toContain("gsc experts guide pi-messages");
      expect(result?.systemPrompt).toContain("gsc pi sessions inbox summary --session-id session-1");
    });

    it("omits the mailbox block when no session is bound", async () => {
      config.rulesEnabled = false;
      const ctx = createContext();
      (ctx.sessionManager as any).getSessionId = () => null;

      const result = await controller.handleBeforeAgentStart(createBeforeAgentStartEvent(), ctx);

      expect(result?.systemPrompt).not.toContain("Your mailbox address is");
    });
  });

  describe("marker detection", () => {
    it("detects marker in string content", () => {
      config.guideEnabled = true;
      const content = `Here is my response.\n\n${PI_WORKSTATE_MARKER}`;
      const hasMarker = (controller as any).detectMarkerInContent(content);
      expect(hasMarker).toBe(true);
    });

    it("detects marker in text block array", () => {
      config.guideEnabled = true;
      const content = [
        { type: "text", text: `Here is my response.\n\n${PI_WORKSTATE_MARKER}` },
        { type: "thinking", thinking: "internal reasoning" },
      ];
      const hasMarker = (controller as any).detectMarkerInContent(content);
      expect(hasMarker).toBe(true);
    });

    it("returns false when no marker present", () => {
      config.guideEnabled = true;
      const content = "Here is my response without marker.";
      const hasMarker = (controller as any).detectMarkerInContent(content);
      expect(hasMarker).toBe(false);
    });

    it("returns false for empty text blocks", () => {
      config.guideEnabled = true;
      const content = [
        { type: "text", text: "" },
        { type: "thinking", thinking: "internal reasoning" },
      ];
      const hasMarker = (controller as any).detectMarkerInContent(content);
      expect(hasMarker).toBe(false);
    });
  });

  describe("marker removal", () => {
    it("removes marker from string content", () => {
      config.guideEnabled = true;
      const content = `Here is my response.\n\n${PI_WORKSTATE_MARKER}`;
      const cleaned = (controller as any).removeMarkerFromContent(content);
      expect(cleaned).toBe("Here is my response.");
    });

    it("removes marker from text block array", () => {
      config.guideEnabled = true;
      const content = [
        { type: "text", text: `Here is my response.\n\n${PI_WORKSTATE_MARKER}` },
        { type: "thinking", thinking: "internal reasoning" },
      ];
      const cleaned = (controller as any).removeMarkerFromContent(content);
      expect(cleaned).toEqual([
        { type: "text", text: "Here is my response." },
        { type: "thinking", thinking: "internal reasoning" },
      ]);
    });

    it("preserves non-text blocks", () => {
      config.guideEnabled = true;
      const content = [
        { type: "text", text: `Response\n${PI_WORKSTATE_MARKER}` },
        { type: "toolCall", id: "call-1", name: "bash", arguments: {} },
      ];
      const cleaned = (controller as any).removeMarkerFromContent(content);
      expect(cleaned[1]).toEqual({ type: "toolCall", id: "call-1", name: "bash", arguments: {} });
    });
  });

  describe("processAssistantMessageForMarker", () => {
    it("returns undefined when guide is disabled", () => {
      config.guideEnabled = false;
      const message = {
        role: "assistant",
        content: [{ type: "text", text: `Response\n${PI_WORKSTATE_MARKER}` }],
        api: "anthropic",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      const result = controller.processAssistantMessageForMarker(message);
      expect(result).toBeUndefined();
    });

    it("returns undefined when no marker present", () => {
      config.guideEnabled = true;
      const message = {
        role: "assistant",
        content: [{ type: "text", text: "Response without marker." }],
        api: "anthropic",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      const result = controller.processAssistantMessageForMarker(message);
      expect(result).toBeUndefined();
    });

    it("returns cleaned message when marker present", () => {
      config.guideEnabled = true;
      const message = {
        role: "assistant",
        content: [{ type: "text", text: `Response\n${PI_WORKSTATE_MARKER}` }],
        api: "anthropic",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      const result = controller.processAssistantMessageForMarker(message);
      expect(result).toBeDefined();
      expect(result!.role).toBe("assistant");
      expect(result!.content).toEqual([{ type: "text", text: "Response" }]);
    });

    it("preserves message role and other fields", () => {
      config.guideEnabled = true;
      const message = {
        role: "assistant",
        content: [{ type: "text", text: `Response\n${PI_WORKSTATE_MARKER}` }],
        api: "anthropic",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150, cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } },
        stopReason: "stop",
        timestamp: 1234567890,
      };
      const result = controller.processAssistantMessageForMarker(message);
      expect(result).toBeDefined();
      expect(result!.role).toBe("assistant");
      expect(result!.api).toBe("anthropic");
      expect(result!.provider).toBe("anthropic");
      expect(result!.model).toBe("claude-sonnet-4-20250514");
      expect(result!.usage).toEqual(message.usage);
      expect(result!.stopReason).toBe("stop");
      expect(result!.timestamp).toBe(1234567890);
    });
    it("logs a work_state event when marker is detected and removed", () => {
      const dir = mkdtempSync(join(tmpdir(), "pi-brains-guide-workstate-"));
      try {
        const sessionFile = join(dir, "session.jsonl");

        controller.start(createContext(sessionFile));
        // Enable guide mode after start (guide is session-only)
        controller.setGuideEnabled(true);

        const message = {
          role: "assistant",
          content: [{ type: "text", text: `Response\n${PI_WORKSTATE_MARKER}` }],
          api: "anthropic",
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150, cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } },
          stopReason: "stop",
          timestamp: Date.now(),
        };
        const result = controller.processAssistantMessageForMarker(message);
        expect(result).toBeDefined();

        const logFile = join(dir, "session.checkpoints.jsonl");
        const entries = readFileSync(logFile, "utf8")
          .trim()
          .split("\n")
          .map(line => JSON.parse(line));
        const workState = entries.find((e: any) => e.type === "work_state");
        expect(workState).toBeDefined();
        expect(workState.schemaVersion).toBe(1);
        expect(workState.source).toBe("agent_marker");
        expect(workState.reason).toBe("agent_requested");
        expect(workState.phase).toBe("checkpoint_requested");
        expect(workState.summary).toBe("Agent requested a Work State checkpoint.");
        expect(workState.checkpointId).toMatch(/^chk_/);
        expect(workState.counters.agentMarkersDetected).toBe(1);
        expect(workState.counters.agentMarkersRemoved).toBe(1);
        expect(workState.counters.manualCheckpoints).toBe(0);
        expect(workState.counters.checkpointsRequested).toBe(1);
        expect(workState.facts.trackedFileCount).toBe(0);
        expect(workState.facts.toolCallsSinceLastCheckpoint).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("counts tracked files as changed on the first checkpoint", () => {
      const dir = mkdtempSync(join(tmpdir(), "pi-brains-guide-first-files-"));
      try {
        const sessionFile = join(dir, "session.jsonl");

        controller.start(createContext(sessionFile));
        // Enable guide mode after start (guide is session-only)
        controller.setGuideEnabled(true);
        const ctx = createContext(sessionFile);
        controller.recordToolResult({
          type: "tool_result",
          toolCallId: "call-1",
          toolName: "read",
          input: { path: "internal/cli/pi/guide.go" },
          content: [{ type: "text", text: "ok" }],
          isError: false,
        } as any, ctx);

        controller.requestGuideCheckpoint("manual");

        const logFile = join(dir, "session.checkpoints.jsonl");
        const entries = readFileSync(logFile, "utf8")
          .trim()
          .split("\n")
          .map(line => JSON.parse(line));
        const workState = entries.findLast((e: any) => e.type === "work_state");
        expect(workState).toBeDefined();
        expect(workState.facts.trackedFileCount).toBe(1);
        expect(workState.facts.filesChangedSinceLastCheckpoint).toBe(1);
        expect(workState.facts.toolCallsSinceLastCheckpoint).toBe(1);
        expect(workState.facts.latestToolName).toBe("read");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("commits checkpoint state only after verification", () => {
      const dir = mkdtempSync(join(tmpdir(), "pi-brains-guide-checkpoint-lifecycle-"));
      try {
        const sessionFile = join(dir, "session.jsonl");
        const ctx = createContext(sessionFile);

        controller.start(ctx);
        controller.setGuideEnabled(true);
        controller.recordToolResult({
          type: "tool_result",
          toolCallId: "call-1",
          toolName: "read",
          input: { path: "src/first.ts" },
          content: [{ type: "text", text: "ok" }],
          isError: false,
        } as any, ctx);

        const failed = controller.requestGuideCheckpoint("manual");
        expect(failed.trackedFiles).toContain("/repo/src/first.ts");
        expect(failed.toolNames).toContain("read");
        controller.failGuideCheckpoint(failed.checkpointId, "append failed");

        const retry = controller.requestGuideCheckpoint("manual");
        let entries = readFileSync(join(dir, "session.checkpoints.jsonl"), "utf8")
          .trim()
          .split("\n")
          .map(line => JSON.parse(line));
        let workState = entries.filter((entry: any) => entry.type === "work_state").at(-1);
        expect(workState.previousCheckpointId).toBeNull();
        expect(workState.facts.toolCallsSinceLastCheckpoint).toBe(1);

        expect(controller.completeGuideCheckpoint(retry.checkpointId)).toBe(true);
        controller.recordToolResult({
          type: "tool_result",
          toolCallId: "call-2",
          toolName: "write",
          input: { path: "src/second.ts" },
          content: [{ type: "text", text: "ok" }],
          isError: false,
        } as any, ctx);
        controller.requestGuideCheckpoint("manual");

        entries = readFileSync(join(dir, "session.checkpoints.jsonl"), "utf8")
          .trim()
          .split("\n")
          .map(line => JSON.parse(line));
        workState = entries.filter((entry: any) => entry.type === "work_state").at(-1);
        expect(workState.previousCheckpointId).toBe(retry.checkpointId);
        expect(workState.facts.toolCallsSinceLastCheckpoint).toBe(1);
        expect(entries.some((entry: any) => entry.type === "checkpoint_failed" && entry.checkpointId === failed.checkpointId)).toBe(true);
        expect(entries.some((entry: any) => entry.type === "checkpoint_verified" && entry.checkpointId === retry.checkpointId)).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
