import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleInboxAutoCommand, handleInboxCodeCommand, handleInboxCommand, showInboxInfo, startInboxWatcher, type InboxController } from "../extensions/pi-brains/inbox.ts";

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

describe("agent-to-agent messaging (phase 2)", () => {
  const AGENT = "33333333-3333-4333-8333-333333333333";
  const PEER = "44444444-4444-4444-8444-444444444444";
  const GROUP_ID = "66666666-6666-4666-8666-666666666666";
  const DELIVERY_ID = "99999999-9999-4999-8999-999999999999";

  function agentMessage(parent: string | null = null): string {
    return JSON.stringify({
      schema_version: 2,
      origin: "agent",
      session_id: SESSION_ID,
      message_id: AGENT,
      status: "pending",
      created_at: "2026-08-05T12:00:00Z",
      updated_at: "2026-08-05T12:00:00Z",
      body: "peer controlled text",
      envelope: {
        version: 1,
        thread_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sender_session_id: PEER,
        reply_to_message_id: parent,
        hop: 1,
        max_hops: 2,
        path: [{ message_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", from: PEER, to: SESSION_ID }],
      },
    });
  }

  function interruptedAgentMessage(deliveryId = DELIVERY_ID, parent: string | null = null): string {
    return JSON.stringify({
      ...JSON.parse(agentMessage(parent)),
      status: "delivering",
      delivery_id: deliveryId,
      delivery_lease_expired: true,
    });
  }

  function emptySummary(): string {
    return JSON.stringify({
      session_id: SESSION_ID,
      mailbox: {
        inbound: { pending: 0, delivering: 0, accepted: 0, ignored: 0, expired: 0 },
        outbound: { sent: 0, replied: 0, awaiting: 0, expired: 0, rejected: 0 },
      },
      wait_groups: [],
    });
  }

  function summaryWithGroup(): string {
    return JSON.stringify({
      session_id: SESSION_ID,
      mailbox: {
        inbound: { pending: 0, delivering: 0, accepted: 0, ignored: 0, expired: 0 },
        outbound: { sent: 1, replied: 1, awaiting: 0, expired: 0, rejected: 0 },
      },
      wait_groups: [{ id: GROUP_ID, expected: 1, received: 1, status: "complete", deadline: "2026-08-05T14:00:00Z" }],
    });
  }

  function waitStatus(events: unknown[]): string {
    return JSON.stringify({
      wait_group_id: GROUP_ID,
      owner_session_id: SESSION_ID,
      expected_count: 1,
      expected_outbound_ids: [],
      received_reply_ids: [],
      deadline: "2026-08-05T14:00:00Z",
      status: "complete",
      events,
    });
  }

  function writeOutboxRecord(sessionId: string, record: Record<string, unknown>): void {
    const dir = join(process.env.GSC_HOME!, "data", "pi", "sessions", sessionId, "outbox");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${record.outbox_message_id}.json`), JSON.stringify(record));
  }

  function withGscHome(): () => void {
    const previous = process.env.GSC_HOME;
    const home = mkdtempSync(join(tmpdir(), "pi-brains-test-"));
    process.env.GSC_HOME = home;
    return () => { process.env.GSC_HOME = previous; };
  }

  it("auto-accepts v2 body-only human mail (dual-read body ?? message)", async () => {
    vi.useFakeTimers();
    try {
      const v2Human = JSON.stringify({
        schema_version: 2,
        origin: "human",
        session_id: SESSION_ID,
        message_id: AGENT,
        status: "pending",
        created_at: "2026-08-05T12:00:00Z",
        updated_at: "2026-08-05T12:00:00Z",
        body: "v2 body only",
      });
      const runGscCommand = vi.fn(async (...args: string[]) => {
        if (args.includes("poll")) return { code: 0, stdout: JSON.stringify({ session_id: SESSION_ID, messages: [JSON.parse(v2Human)] }), stderr: "" };
        if (args.includes("claim")) {
          const claimed = JSON.parse(v2Human);
          claimed.status = "delivering";
          claimed.delivery_id = "55555555-5555-4555-8555-555555555555";
          return { code: 0, stdout: JSON.stringify(claimed), stderr: "" };
        }
        if (args.includes("complete")) return { code: 0, stdout: v2Human, stderr: "" };
        if (args.includes("summary")) return { code: 0, stdout: emptySummary(), stderr: "" };
        return { code: 1, stdout: "", stderr: "unexpected command" };
      });
      const { controller, sendUserMessage } = createController(runGscCommand);
      const { ctx } = createContext([]);
      const watcher = startInboxWatcher(controller, ctx as unknown as ExtensionContext, { pollIntervalMs: 10, initialAutoAccept: true });
      handleInboxAutoCommand("on", watcher, ctx);
      await vi.advanceTimersByTimeAsync(20);
      expect(sendUserMessage).toHaveBeenCalledWith("v2 body only", undefined);
      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts expired and agent statuses in poll parsing", async () => {
    const runGscCommand = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({
        session_id: SESSION_ID,
        messages: [
          { ...JSON.parse(agentMessage()), status: "expired" },
          { schema_version: 1, session_id: SESSION_ID, message_id: "77777777-7777-4777-8777-777777777777", status: "accepted", created_at: "2026-08-05T12:00:00Z", updated_at: "2026-08-05T12:00:00Z", message: "legacy" },
        ],
      }),
      stderr: "",
    }));
    const { controller } = createController(runGscCommand);
    const { ctx } = createContext([]);
    await handleInboxCommand(controller, ctx, "list");
    expect(runGscCommand).toHaveBeenCalled();
  });

  it("never auto-accepts agent mail and emits metadata-only you-have-mail", async () => {
    vi.useFakeTimers();
    try {
      const restore = withGscHome();
      const runGscCommand = vi.fn(async (...args: string[]) => {
        if (args.includes("poll")) {
          return { code: 0, stdout: JSON.stringify({ session_id: SESSION_ID, messages: [JSON.parse(agentMessage())] }), stderr: "" };
        }
        if (args.includes("summary")) return { code: 0, stdout: emptySummary(), stderr: "" };
        return { code: 1, stdout: "", stderr: "unexpected command" };
      });
      const { controller, sendUserMessage } = createController(runGscCommand);
      const { ctx, notify } = createContext([]);
      const watcher = startInboxWatcher(controller, ctx as unknown as ExtensionContext, { pollIntervalMs: 10, initialAutoAccept: true });
      handleInboxAutoCommand("on", watcher, ctx);
      await vi.advanceTimersByTimeAsync(20);
      expect(runGscCommand).not.toHaveBeenCalledWith(expect.arrayContaining(["claim"]));
      expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("You have mail (1)"), undefined);
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("You have mail (1)"), "info");
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("--kind agent --limit 1"), "info");
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("gsc experts guide pi-messages"), "info");
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("message " + AGENT.slice(0, 8)), "info");
      watcher.stop();
      restore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists agent notification ids and does not redeliver pending mail after restart", async () => {
    vi.useFakeTimers();
    try {
      const restore = withGscHome();
      const runGscCommand = vi.fn(async (...args: string[]) => {
        if (args.includes("poll")) {
          return { code: 0, stdout: JSON.stringify({ session_id: SESSION_ID, messages: [JSON.parse(agentMessage())] }), stderr: "" };
        }
        if (args.includes("summary")) return { code: 0, stdout: emptySummary(), stderr: "" };
        return { code: 1, stdout: "", stderr: "unexpected command" };
      });
      const { controller, sendUserMessage } = createController(runGscCommand);
      const { ctx, notify } = createContext([]);
      let persisted: string[] = [];
      const first = startInboxWatcher(controller, ctx as unknown as ExtensionContext, {
        pollIntervalMs: 10,
        onNotifiedAgentMessageIdsChange: (messageIds) => { persisted = messageIds; },
      });
      await vi.advanceTimersByTimeAsync(10);
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(persisted).toEqual([AGENT]);
      first.stop();

      sendUserMessage.mockClear();
      notify.mockClear();
      const restarted = startInboxWatcher(controller, ctx as unknown as ExtensionContext, {
        pollIntervalMs: 10,
        notifiedAgentMessageIds: persisted,
      });
      await vi.advanceTimersByTimeAsync(20);
      expect(sendUserMessage).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalledWith(expect.stringContaining("You have mail"), "info");
      restarted.stop();
      restore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renotifies an expired delivery lease once per abandoned delivery id", async () => {
    vi.useFakeTimers();
    try {
      const restore = withGscHome();
      let deliveryId = DELIVERY_ID;
      const runGscCommand = vi.fn(async (...args: string[]) => {
        if (args.includes("poll")) {
          return { code: 0, stdout: JSON.stringify({ session_id: SESSION_ID, messages: [JSON.parse(interruptedAgentMessage(deliveryId))] }), stderr: "" };
        }
        if (args.includes("summary")) return { code: 0, stdout: emptySummary(), stderr: "" };
        return { code: 1, stdout: "", stderr: "unexpected command" };
      });
      const { controller, sendUserMessage } = createController(runGscCommand);
      const { ctx, notify } = createContext([]);
      let persisted = [AGENT];
      const first = startInboxWatcher(controller, ctx as unknown as ExtensionContext, {
        pollIntervalMs: 10,
        notifiedAgentMessageIds: persisted,
        onNotifiedAgentMessageIdsChange: (messageIds) => { persisted = messageIds; },
      });
      await vi.advanceTimersByTimeAsync(20);
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("interrupted delivery ready to retry"), undefined);
      expect(persisted).toEqual([AGENT, `${AGENT}:${DELIVERY_ID}`]);
      first.stop();

      sendUserMessage.mockClear();
      notify.mockClear();
      const restarted = startInboxWatcher(controller, ctx as unknown as ExtensionContext, {
        pollIntervalMs: 10,
        notifiedAgentMessageIds: persisted,
      });
      await vi.advanceTimersByTimeAsync(20);
      expect(sendUserMessage).not.toHaveBeenCalled();
      restarted.stop();

      deliveryId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
      const retried = startInboxWatcher(controller, ctx as unknown as ExtensionContext, {
        pollIntervalMs: 10,
        notifiedAgentMessageIds: persisted,
      });
      await vi.advanceTimersByTimeAsync(20);
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      retried.stop();
      restore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("suppresses you-have-mail when the reply matches an awaiting outbound", async () => {
    vi.useFakeTimers();
    try {
      const restore = withGscHome();
      const PARENT = "55555555-5555-4555-8555-555555555555";
      writeOutboxRecord(SESSION_ID, {
        outbox_message_id: PARENT,
        sender_session_id: SESSION_ID,
        recipient_session_id: PEER,
        reply_to_message_id: null,
        wait_group_id: GROUP_ID,
        attempt: { id: PARENT, idempotency_key: "88888888-8888-4888-8888-888888888888", request_hash: "h", status: "committed" },
        created_at: "2026-08-05T11:00:00Z",
      });
      let calls = 0;
      const runGscCommand = vi.fn(async (...args: string[]) => {
        if (args.includes("poll")) {
          calls += 1;
          return { code: 0, stdout: JSON.stringify({ session_id: SESSION_ID, messages: calls > 1 ? [JSON.parse(agentMessage(PARENT))] : [] }), stderr: "" };
        }
        if (args.includes("summary")) return { code: 0, stdout: emptySummary(), stderr: "" };
        return { code: 1, stdout: "", stderr: "unexpected command" };
      });
      const { controller } = createController(runGscCommand);
      const { ctx, notify } = createContext([]);
      const watcher = startInboxWatcher(controller, ctx as unknown as ExtensionContext, { pollIntervalMs: 10 });
      await vi.advanceTimersByTimeAsync(20);
      expect(notify).not.toHaveBeenCalledWith(expect.stringContaining("You have mail"), "info");
      watcher.stop();
      restore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("wakes for an interrupted grouped reply even after its original notice was suppressed", async () => {
    vi.useFakeTimers();
    try {
      const restore = withGscHome();
      const PARENT = "55555555-5555-4555-8555-555555555555";
      writeOutboxRecord(SESSION_ID, {
        outbox_message_id: PARENT,
        sender_session_id: SESSION_ID,
        recipient_session_id: PEER,
        reply_to_message_id: null,
        wait_group_id: GROUP_ID,
        attempt: { id: PARENT, idempotency_key: "88888888-8888-4888-8888-888888888888", request_hash: "h", status: "committed" },
        created_at: "2026-08-05T11:00:00Z",
      });
      const runGscCommand = vi.fn(async (...args: string[]) => {
        if (args.includes("poll")) {
          return { code: 0, stdout: JSON.stringify({ session_id: SESSION_ID, messages: [JSON.parse(interruptedAgentMessage(DELIVERY_ID, PARENT))] }), stderr: "" };
        }
        if (args.includes("summary")) return { code: 0, stdout: emptySummary(), stderr: "" };
        return { code: 1, stdout: "", stderr: "unexpected command" };
      });
      const { controller, sendUserMessage } = createController(runGscCommand);
      const { ctx } = createContext([]);
      const watcher = startInboxWatcher(controller, ctx as unknown as ExtensionContext, {
        pollIntervalMs: 10,
        notifiedAgentMessageIds: [AGENT],
      });
      await vi.advanceTimersByTimeAsync(20);
      expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("interrupted delivery ready to retry"), undefined);
      watcher.stop();
      restore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("you-have-mail fires for a reply to an ungrouped (fire-and-forget) outbound", async () => {
    vi.useFakeTimers();
    try {
      const restore = withGscHome();
      const PARENT = "55555555-5555-4555-8555-555555555555";
      writeOutboxRecord(SESSION_ID, {
        outbox_message_id: PARENT,
        sender_session_id: SESSION_ID,
        recipient_session_id: PEER,
        reply_to_message_id: null,
        wait_group_id: null,
        attempt: { id: PARENT, idempotency_key: "88888888-8888-4888-8888-888888888888", request_hash: "h", status: "committed" },
        created_at: "2026-08-05T09:00:00Z",
      });
      let calls = 0;
      const runGscCommand = vi.fn(async (...args: string[]) => {
        if (args.includes("poll")) {
          calls += 1;
          return { code: 0, stdout: JSON.stringify({ session_id: SESSION_ID, messages: calls > 1 ? [JSON.parse(agentMessage(PARENT))] : [] }), stderr: "" };
        }
        if (args.includes("summary")) return { code: 0, stdout: emptySummary(), stderr: "" };
        return { code: 1, stdout: "", stderr: "unexpected command" };
      });
      const { controller, sendUserMessage } = createController(runGscCommand);
      const { ctx, notify } = createContext([]);
      const watcher = startInboxWatcher(controller, ctx as unknown as ExtensionContext, { pollIntervalMs: 10 });
      await vi.advanceTimersByTimeAsync(20);
      // Ungrouped sends are fire-and-forget: a reply arrives as ordinary mail.
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("You have mail"), "info");
      expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("You have mail"), undefined);
      watcher.stop();
      restore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("notifies once per unseen wait-group event and persists the cursor", async () => {
    vi.useFakeTimers();
    try {
      let eventSeq = 0;
      const runGscCommand = vi.fn(async (...args: string[]) => {
        if (args.includes("summary")) return { code: 0, stdout: summaryWithGroup(), stderr: "" };
        if (args.includes("wait") && args.includes("status")) {
          return { code: 0, stdout: waitStatus(eventSeq === 0 ? [] : [{ event_id: "evt-1", event_seq: 1, type: "complete", at: "2026-08-05T12:30:00Z", details: '{"expected":1,"received":1}' }]), stderr: "" };
        }
        return { code: 1, stdout: "", stderr: "unexpected command" };
      });
      const { controller } = createController(runGscCommand);
      const { ctx, notify } = createContext([]);
      const onCursors = vi.fn();
      const onSummary = vi.fn();
      const watcher = startInboxWatcher(controller, ctx as unknown as ExtensionContext, {
        waitGroupPollIntervalMs: 10,
        onWaitGroupCursorsChange: onCursors,
        onMailboxSummary: onSummary,
      });
      await vi.advanceTimersByTimeAsync(10);
      expect(notify).not.toHaveBeenCalled();
      eventSeq = 1;
      await vi.advanceTimersByTimeAsync(10);
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("1/1 replies received"), "info");
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("event evt-1"), "info");
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("fetch --session-id " + SESSION_ID + " --wait-group-id " + GROUP_ID),
        "info",
      );
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("complete each claimed reply"), "info");
      expect(onSummary).toHaveBeenCalled();
      expect(onCursors).toHaveBeenCalledWith({ [GROUP_ID]: 1 });
      const notifyCount = notify.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10);
      expect(notify.mock.calls.length).toBe(notifyCount);
      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not replay a wait-group event after restart with its durable cursor", async () => {
    vi.useFakeTimers();
    try {
      const runGscCommand = vi.fn(async (...args: string[]) => {
        if (args.includes("summary")) return { code: 0, stdout: summaryWithGroup(), stderr: "" };
        if (args.includes("wait") && args.includes("status")) {
          return { code: 0, stdout: waitStatus([{ event_id: "evt-1", event_seq: 1, type: "complete", at: "2026-08-05T12:30:00Z", details: '{"expected":1,"received":1}' }]), stderr: "" };
        }
        return { code: 1, stdout: "", stderr: "unexpected command" };
      });
      const { controller, sendUserMessage } = createController(runGscCommand);
      const { ctx, notify } = createContext([]);
      let persisted: Record<string, number> = {};
      const first = startInboxWatcher(controller, ctx as unknown as ExtensionContext, {
        waitGroupPollIntervalMs: 10,
        onWaitGroupCursorsChange: (cursors) => { persisted = cursors; },
      });
      await vi.advanceTimersByTimeAsync(10);
      expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("event evt-1"), undefined);
      expect(persisted).toEqual({ [GROUP_ID]: 1 });
      first.stop();

      sendUserMessage.mockClear();
      notify.mockClear();
      const restarted = startInboxWatcher(controller, ctx as unknown as ExtensionContext, {
        waitGroupPollIntervalMs: 10,
        waitGroupCursors: persisted,
      });
      await vi.advanceTimersByTimeAsync(20);
      expect(sendUserMessage).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalledWith(expect.stringContaining("event evt-1"), "info");
      restarted.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows mailbox information with copy and close actions", async () => {
    const runGscCommand = vi.fn(async (...args: string[]) => {
      if (args.includes("summary")) return { code: 0, stdout: summaryWithGroup(), stderr: "" };
      return { code: 1, stdout: "", stderr: "unexpected command" };
    });
    const { controller } = createController(runGscCommand);
    const { ctx, select } = createContext(["Close"]);
    await handleInboxCommand(controller, ctx, "info");
    expect(select).toHaveBeenCalledWith(expect.any(String), ["Copy mailbox address", "Close"]);
    const prompt = select.mock.calls[0]?.[0] ?? "";
    expect(prompt).toContain(SESSION_ID);
    expect(prompt).toContain("gsc experts guide pi-messages");
    expect(prompt).toContain("untrusted delegated input");
    expect(prompt).toContain("complete 1/1");
  });

  it("copies the mailbox address from inbox info", async () => {
    const runGscCommand = vi.fn(async (...args: string[]) => {
      if (args.includes("summary")) return { code: 0, stdout: summaryWithGroup(), stderr: "" };
      return { code: 1, stdout: "", stderr: "unexpected command" };
    });
    const { controller } = createController(runGscCommand);
    const { ctx, notify } = createContext(["Copy mailbox address"]);
    const copy = vi.fn(async () => {});

    await showInboxInfo(controller, ctx, SESSION_ID, copy);

    expect(copy).toHaveBeenCalledWith(SESSION_ID);
    expect(notify).toHaveBeenCalledWith("Mailbox address copied to clipboard", "info");
  });
});


describe("inbox code lifecycle (/brains inbox code)", () => {
  it("confirms generation without showing or copying the code", async () => {
    const runGscCommand = vi.fn(async (...args: string[]) => {
      if (args.includes("generate")) {
        return { code: 0, stdout: "Inbox code: 123456\nExpires: 2026-11-03T17:21:44Z\nStore: /tmp/gsc-store\n", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "unexpected command" };
    });
    const { controller } = createController(runGscCommand);
    const { ctx, notify, select } = createContext([]);
    await handleInboxCodeCommand(controller, ctx, "generate");
    // The user is told sending is now enabled — the code itself is not shown
    // (no paste step) and the clipboard is never touched.
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Inbox code generated."), "info");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("send messages from GitSense Chat"), "info");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Valid until 2026-11-03T17:21:44Z"), "info");
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining("Inbox code: 123456"), "info");
    expect(select).not.toHaveBeenCalled();
  });

  it("deletes the inbox code and warns sending is disabled", async () => {
    const runGscCommand = vi.fn(async (...args: string[]) => {
      if (args.includes("delete")) return { code: 0, stdout: "Inbox code deleted.", stderr: "" };
      return { code: 1, stdout: "", stderr: "unexpected command" };
    });
    const { controller } = createController(runGscCommand);
    const { ctx, notify } = createContext([]);
    await handleInboxCodeCommand(controller, ctx, "delete");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("deleted"), "info");
  });

  it("shows the inbox code status", async () => {
    const runGscCommand = vi.fn(async (...args: string[]) => {
      if (args.includes("status")) return { code: 0, stdout: "No inbox code.\n", stderr: "" };
      return { code: 1, stdout: "", stderr: "unexpected command" };
    });
    const { controller } = createController(runGscCommand);
    const { ctx, notify } = createContext([]);
    await handleInboxCodeCommand(controller, ctx, "status");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No inbox code."), "info");
  });

  it("rejects unknown actions with usage", async () => {
    const runGscCommand = vi.fn();
    const { controller } = createController(runGscCommand);
    const { ctx, notify } = createContext([]);
    await handleInboxCodeCommand(controller, ctx, "frobnicate");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage: /brains inbox code"), "warning");
  });

  it("reports a generation failure", async () => {
    const runGscCommand = vi.fn(async () => ({ code: 1, stdout: "", stderr: "gsc failed" }));
    const { controller } = createController(runGscCommand);
    const { ctx, notify } = createContext([]);
    await handleInboxCodeCommand(controller, ctx, "generate");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("gsc failed"), "error");
  });
});

describe("inbox clear (/brains inbox clear)", () => {
  it("dismisses rejected sends and reports the count", async () => {
    const runGscCommand = vi.fn(async (...args: string[]) => {
      if (args.includes("clear-rejected")) {
        return { code: 0, stdout: JSON.stringify({ session_id: SESSION_ID, cleared: 2 }), stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "unexpected command" };
    });
    const { controller } = createController(runGscCommand);
    const { ctx, notify } = createContext([]);
    await handleInboxCommand(controller, ctx, "clear");
    expect(runGscCommand).toHaveBeenCalledWith("pi", "sessions", "inbox", "clear-rejected", "--session-id", SESSION_ID);
    expect(notify).toHaveBeenCalledWith("Cleared 2 rejected sends.", "info");
  });

  it("reports when there is nothing to clear", async () => {
    const runGscCommand = vi.fn(async () => ({ code: 0, stdout: JSON.stringify({ session_id: SESSION_ID, cleared: 0 }), stderr: "" }));
    const { controller } = createController(runGscCommand);
    const { ctx, notify } = createContext([]);
    await handleInboxCommand(controller, ctx, "clear");
    expect(notify).toHaveBeenCalledWith("No rejected sends to clear.", "info");
  });

  it("reports a clear failure", async () => {
    const runGscCommand = vi.fn(async () => ({ code: 1, stdout: "", stderr: "gsc failed" }));
    const { controller } = createController(runGscCommand);
    const { ctx, notify } = createContext([]);
    await handleInboxCommand(controller, ctx, "clear");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("gsc failed"), "error");
  });
});
