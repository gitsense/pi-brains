import { describe, expect, it, beforeEach } from "vitest";
import { PiBrainsController } from "../extensions/pi-brains/controller.ts";
import { DEFAULT_CONFIG } from "../extensions/pi-brains/config.ts";
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

describe("guide mode", () => {
  let controller: PiBrainsController;
  let config: PiBrainsConfig;

  beforeEach(() => {
    config = { ...DEFAULT_CONFIG, guideEnabled: false };
    controller = new PiBrainsController(createMockPi(), config);
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
  });
});
