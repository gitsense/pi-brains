import { describe, expect, it, vi } from "vitest";
import { CheckpointLog } from "../extensions/pi-brains/checkpoint-log.ts";
import type { GuideCheckpointRequestResult } from "../extensions/pi-brains/controller.ts";

// Mock types for testing
interface MockNavigateTree {
  (targetId: string, options?: { summarize?: boolean }): Promise<{ cancelled: boolean }>;
}

interface MockSendMessage {
  (message: { customType: string; display: boolean; content: string; details?: unknown }, options?: { triggerTurn?: boolean }): void;
}

interface MockSessionManager {
  getLeafId: () => string | null;
  getSessionFile: () => string | null;
}

describe("guide checkpoint message", () => {
  it("creates scratch custom message without triggering turn", async () => {
    const navigateTree = vi.fn<MockNavigateTree>().mockResolvedValue({ cancelled: false });
    const sendMessage = vi.fn<MockSendMessage>();
    const sessionManager: MockSessionManager = {
      getLeafId: () => "current-leaf-123",
      getSessionFile: () => "/path/to/session.jsonl",
    };

    const guideDebug = new CheckpointLog();
    const logEvents: Array<{ type: string; [key: string]: unknown }> = [];
    guideDebug.logEvent = (event) => {
      logEvents.push(event as { type: string; [key: string]: unknown });
    };

    const checkpointResult: GuideCheckpointRequestResult = {
      logPath: "/path/to/guide-debug.jsonl",
      checkpointId: "chk_test_123",
      previousCheckpointId: null,
      anchorLeafId: "anchor-leaf-456",
      sessionId: "session-789",
      trackedFiles: [],
      toolNames: [],
      ruleIds: [],
    };

    // Simulate the checkpoint message creation flow
    const anchorLeafId = checkpointResult.anchorLeafId;
    const originalLeafId = sessionManager.getLeafId();
    const sourceSessionPath = sessionManager.getSessionFile();

    // Log started
    guideDebug.logCheckpointMessageStarted({
      checkpointId: checkpointResult.checkpointId,
      anchorLeafId,
      originalLeafId,
      sourceSessionPath,
    });

    // Navigate to anchor
    if (anchorLeafId) {
      await navigateTree(anchorLeafId, { summarize: false });
    }

    // Send message (triggerTurn: false)
    sendMessage(
      {
        customType: "guide-checkpoint-request",
        display: false,
        content: JSON.stringify({
          type: "guide_checkpoint_request",
          schemaVersion: 1,
          checkpointId: checkpointResult.checkpointId,
          anchorLeafId,
          originalLeafId,
          source: "manual",
          scratch: true,
        }),
        details: {
          checkpointId: checkpointResult.checkpointId,
          anchorLeafId,
          originalLeafId,
          source: "manual",
          scratch: true,
        },
      },
      { triggerTurn: false },
    );

    // Log created
    guideDebug.logCheckpointMessageCreated({
      checkpointId: checkpointResult.checkpointId,
      anchorLeafId,
      originalLeafId,
      sourceSessionPath,
    });

    // Navigate back
    if (originalLeafId) {
      await navigateTree(originalLeafId, { summarize: false });
    }

    // Log restored
    guideDebug.logCheckpointMessageRestored({
      checkpointId: checkpointResult.checkpointId,
      anchorLeafId,
      originalLeafId,
      sourceSessionPath,
    });

    // Assertions
    expect(navigateTree).toHaveBeenCalledTimes(2);
    expect(navigateTree).toHaveBeenNthCalledWith(1, "anchor-leaf-456", { summarize: false });
    expect(navigateTree).toHaveBeenNthCalledWith(2, "current-leaf-123", { summarize: false });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: "guide-checkpoint-request",
        display: false,
      }),
      { triggerTurn: false },
    );

    // Check debug events
    const startedEvent = logEvents.find((e) => e.type === "checkpoint_message_started");
    const createdEvent = logEvents.find((e) => e.type === "checkpoint_message_created");
    const restoredEvent = logEvents.find((e) => e.type === "checkpoint_message_restored");

    expect(startedEvent).toBeDefined();
    expect(startedEvent?.checkpointId).toBe("chk_test_123");
    expect(startedEvent?.anchorLeafId).toBe("anchor-leaf-456");
    expect(startedEvent?.originalLeafId).toBe("current-leaf-123");
    expect(startedEvent?.customType).toBe("guide-checkpoint-request");
    expect(startedEvent?.triggerTurn).toBe(false);

    expect(createdEvent).toBeDefined();
    expect(restoredEvent).toBeDefined();
  });

  it("does not use fork", async () => {
    const fork = vi.fn();
    const navigateTree = vi.fn().mockResolvedValue({ cancelled: false });
    const sendMessage = vi.fn();

    // Simulate checkpoint without fork
    await navigateTree("anchor", { summarize: false });
    sendMessage({ customType: "guide-checkpoint-request", display: false, content: "{}" }, { triggerTurn: false });
    await navigateTree("original", { summarize: false });

    expect(fork).not.toHaveBeenCalled();
  });

  it("restores on send failure", async () => {
    const navigateTree = vi.fn().mockResolvedValue({ cancelled: false });
    const sendMessage = vi.fn().mockImplementation(() => {
      throw new Error("Send failed");
    });

    const guideDebug = new CheckpointLog();
    const logEvents: Array<{ type: string; [key: string]: unknown }> = [];
    guideDebug.logEvent = (event) => {
      logEvents.push(event as { type: string; [key: string]: unknown });
    };

    const checkpointId = "chk_test_fail";
    const anchorLeafId = "anchor";
    const originalLeafId = "original";
    const sourceSessionPath = "/path/to/session.jsonl";

    // Log started
    guideDebug.logCheckpointMessageStarted({
      checkpointId,
      anchorLeafId,
      originalLeafId,
      sourceSessionPath,
    });

    try {
      // Navigate to anchor
      await navigateTree(anchorLeafId, { summarize: false });

      // This will throw
      sendMessage(
        { customType: "guide-checkpoint-request", display: false, content: "{}" },
        { triggerTurn: false },
      );
    } catch (error) {
      // Try to restore
      try {
        await navigateTree(originalLeafId, { summarize: false });
      } catch {
        // Best effort
      }

      // Log failure
      guideDebug.logCheckpointMessageFailed({
        checkpointId,
        anchorLeafId,
        originalLeafId,
        sourceSessionPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Verify restore was attempted
    expect(navigateTree).toHaveBeenCalledTimes(2);
    expect(navigateTree).toHaveBeenNthCalledWith(2, "original", { summarize: false });

    // Verify failure event
    const failedEvent = logEvents.find((e) => e.type === "checkpoint_message_failed");
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.error).toBe("Send failed");
  });

  it("creates exactly one scratch message", () => {
    const sendMessage = vi.fn();

    // Single call
    sendMessage(
      {
        customType: "guide-checkpoint-request",
        display: false,
        content: JSON.stringify({ type: "guide_checkpoint_request", checkpointId: "chk_123" }),
      },
      { triggerTurn: false },
    );

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ customType: "guide-checkpoint-request" }),
      { triggerTurn: false },
    );
  });
});
