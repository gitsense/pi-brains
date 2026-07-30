import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { handleInboxAutoCommand, handleInboxCommand, startInboxWatcher, type InboxController } from "../extensions/pi-brains/inbox.ts";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";

function message(status: "pending" | "delivering" | "accepted" | "ignored", text?: string, deliveryID?: string): string {
  return JSON.stringify({
    schema_version: 1,
    session_id: SESSION_ID,
    message_id: MESSAGE_ID,
    status,
    created_at: "2026-07-27T12:00:00Z",
    updated_at: "2026-07-27T12:00:00Z",
    ...(text === undefined ? {} : { message: text }),
    ...(deliveryID === undefined ? {} : { delivery_id: deliveryID }),
  });
}

function createContext(selections: string[]) {
  const notify = vi.fn();
  const select = vi.fn(async (_title: string, options: string[]) => {
    const selection = selections.shift();
    return selection === "FIRST" ? options[0] : selection ?? "Close";
  });
  const ctx = { mode: "tui", isIdle: () => true, ui: { notify, select } } as unknown as ExtensionCommandContext;
  return { ctx, notify, select };
}

function createController(runGscCommand: InboxController["runGscCommand"]) {
  const sendUserMessage = vi.fn();
  const controller: InboxController = {
    getSessionId: () => SESSION_ID,
    runGscCommand,
    sendUserMessage,
  };
  return { controller, sendUserMessage };
}

describe("Pi session inbox", () => {
  it("shows the empty state with the current auto-accept setting", async () => {
    const runGscCommand = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({ session_id: SESSION_ID, messages: [] }),
      stderr: "",
    }));
    const { controller } = createController(runGscCommand);
    const { ctx, notify } = createContext([]);
    const watcher = {
      stop() {},
      setAutoAccept() {},
      isAutoAcceptEnabled: () => true,
    };

    await handleInboxCommand(controller, ctx, "", watcher);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("✓ The Pi session inbox is empty."),
      "info",
    );
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Auto-accept: **ON**"),
      "info",
    );
  });

  it("reviews and accepts a drafted message", async () => {
    const runGscCommand = vi.fn(async (...args: string[]) => {
      if (args.includes("list")) return { code: 0, stdout: JSON.stringify({ session_id: SESSION_ID, messages: [{ ...JSON.parse(message("pending")), message: "Draft from Chat" }] }), stderr: "" };
      if (args.includes("show")) return { code: 0, stdout: message("pending", "Draft from Chat"), stderr: "" };
      if (args.includes("claim")) return { code: 0, stdout: message("delivering", "Draft from Chat", "33333333-3333-4333-8333-333333333333"), stderr: "" };
      if (args.includes("complete")) return { code: 0, stdout: message("accepted", "Draft from Chat"), stderr: "" };
      return { code: 1, stdout: "", stderr: "unexpected command" };
    });
    const { controller, sendUserMessage } = createController(runGscCommand);
    const { ctx, notify } = createContext(["FIRST", "Accept and send", "Close"]);

    await handleInboxCommand(controller, ctx);

    expect(sendUserMessage).toHaveBeenCalledWith("Draft from Chat", undefined);
    expect(notify).toHaveBeenCalledWith("Inbox message accepted and sent to the Pi session.", "info");
  });

  it("notifies when a new pending message appears", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const runGscCommand = vi.fn(async () => {
        calls += 1;
        return {
          code: 0,
          stdout: JSON.stringify({
            session_id: SESSION_ID,
            messages: calls > 1 ? [{ schema_version: 1, session_id: SESSION_ID, message_id: MESSAGE_ID, status: "pending", created_at: "2026-07-27T12:00:00Z", updated_at: "2026-07-27T12:00:00Z" }] : [],
          }),
          stderr: "",
        };
      });
      const { controller } = createController(runGscCommand);
      const { ctx, notify } = createContext([]);
      const stop = startInboxWatcher(controller, ctx as unknown as ExtensionContext, { pollIntervalMs: 10 });
      await vi.advanceTimersByTimeAsync(20);
      expect(notify).toHaveBeenCalledWith("New message in the Pi session inbox. Run /brains inbox to review.", "info");
      stop.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-accepts a message and queues it as a follow-up while busy", async () => {
    vi.useFakeTimers();
    try {
      const runGscCommand = vi.fn(async (...args: string[]) => {
        if (args.includes("poll")) {
          return { code: 0, stdout: JSON.stringify({ session_id: SESSION_ID, messages: [{ schema_version: 1, session_id: SESSION_ID, message_id: MESSAGE_ID, status: "pending", created_at: "2026-07-27T12:00:00Z", updated_at: "2026-07-27T12:00:00Z" }] }), stderr: "" };
        }
        if (args.includes("claim")) {
          return { code: 0, stdout: message("delivering", "Auto message", "33333333-3333-4333-8333-333333333333"), stderr: "" };
        }
        if (args.includes("complete")) return { code: 0, stdout: message("accepted", "Auto message"), stderr: "" };
        return { code: 1, stdout: "", stderr: "unexpected command" };
      });
      const { controller, sendUserMessage } = createController(runGscCommand);
      const { ctx } = createContext([]);
      Object.assign(ctx, { isIdle: () => false });
      const watcher = startInboxWatcher(controller, ctx as unknown as ExtensionContext, { pollIntervalMs: 10 });
      handleInboxAutoCommand("on", watcher, ctx);
      await vi.advanceTimersByTimeAsync(20);

      expect(sendUserMessage).toHaveBeenCalledWith("Auto message", { deliverAs: "followUp" });
      expect(runGscCommand).toHaveBeenCalledWith(
        "pi", "sessions", "inbox", "complete",
        "--session-id", SESSION_ID,
        "--id", MESSAGE_ID,
        "--delivery-id", "33333333-3333-4333-8333-333333333333",
      );
      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
