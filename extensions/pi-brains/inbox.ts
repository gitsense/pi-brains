import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type ChatAppController, type GscCommandResult } from "./chat-app.ts";
import { showOutputPanel } from "./output-panel.ts";

const DEFAULT_INBOX_POLL_INTERVAL_MS = 2_000;

type InboxStatus = "pending" | "delivering" | "accepted" | "ignored";

export interface InboxMessage {
  schema_version: number;
  session_id: string;
  message_id: string;
  status: InboxStatus;
  created_at: string;
  updated_at: string;
  message?: string;
  delivery_id?: string;
}

interface InboxListResult {
  session_id: string;
  messages: InboxMessage[];
}

export interface InboxController extends ChatAppController {
  getSessionId(): string | null;
  sendUserMessage(message: string, options?: { deliverAs?: "steer" | "followUp" }): void;
}

export interface InboxWatcherHandle {
  stop(): void;
  setAutoAccept(enabled: boolean): void;
  isAutoAcceptEnabled(): boolean;
}

function inboxAutoAcceptStatus(watcher: InboxWatcherHandle | null): "ON" | "OFF" {
  return watcher?.isAutoAcceptEnabled() ? "ON" : "OFF";
}

async function showInboxAutoStatus(ctx: ExtensionCommandContext, watcher: InboxWatcherHandle | null): Promise<void> {
  const autoStatus = inboxAutoAcceptStatus(watcher);
  await showOutputPanel(
    ctx,
    "Pi Session Inbox",
    `Auto-accept: **${autoStatus}**`,
    {
      status: {
        text: `Inbox auto-accept is ${autoStatus}.`,
        color: autoStatus === "ON" ? "success" : "accent",
      },
    },
  );
}

async function showEmptyInbox(ctx: ExtensionCommandContext, watcher: InboxWatcherHandle | null): Promise<void> {
  const autoStatus = inboxAutoAcceptStatus(watcher);
  await showOutputPanel(
    ctx,
    "Pi Session Inbox",
    `Auto-accept: **${autoStatus}**`,
    { status: { text: "✓ The Pi session inbox is empty.", color: "success" } },
  );
}

export function handleInboxAutoCommand(
  value: string,
  watcher: InboxWatcherHandle | null,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const action = value.trim().toLowerCase();
  if (!watcher) {
    ctx.ui.notify("The inbox watcher is not running", "error");
    return Promise.resolve();
  }
  if (action === "on") {
    watcher.setAutoAccept(true);
    ctx.ui.notify("Inbox auto-accept enabled for this Pi session.", "info");
    return Promise.resolve();
  }
  if (action === "off") {
    watcher.setAutoAccept(false);
    ctx.ui.notify("Inbox auto-accept disabled.", "info");
    return Promise.resolve();
  }
  if (action === "status" || action === "") {
    return showInboxAutoStatus(ctx, watcher);
  }
  ctx.ui.notify("Usage: /brains inbox auto on|off|status", "warning");
  return Promise.resolve();
}

async function showInboxHelp(ctx: ExtensionCommandContext, watcher: InboxWatcherHandle | null): Promise<void> {
  const autoStatus = inboxAutoAcceptStatus(watcher);
  const help = `
## Commands

- \/brains inbox — Review pending messages in the Pi session inbox
- \/brains inbox list — List all messages in the session inbox
- \/brains inbox status — Show the current auto-accept setting
- \/brains inbox auto — Configure automatic inbox acceptance
- \/brains inbox auto on — Enable auto-accept for this session
- \/brains inbox auto off — Disable auto-accept
- \/brains inbox auto status — Show the current auto-accept setting
- \/brains inbox help — Show this help

## Current settings

Auto-accept: **${autoStatus}**`;
  await showOutputPanel(ctx, "Pi Session Inbox", help);
}

export async function handleInboxCommand(
  controller: InboxController,
  ctx: ExtensionCommandContext,
  value = "",
  watcher: InboxWatcherHandle | null = null,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/brains inbox is only available in the TUI", "error");
    return;
  }
  const sessionId = controller.getSessionId();
  if (!sessionId) {
    ctx.ui.notify("No active session. Start a conversation first.", "error");
    return;
  }
  if (value.trim() === "help") {
    await showInboxHelp(ctx, watcher);
    return;
  }
  if (value.trim() === "status") {
    await showInboxAutoStatus(ctx, watcher);
    return;
  }
  if (value.trim() === "list") {
    await listInboxMessages(controller, ctx, sessionId, watcher);
    return;
  }

  while (true) {
    const pending = await getInboxMessages(controller, sessionId, "pending");
    if (!pending) {
      ctx.ui.notify("Unable to read the Pi session inbox", "error");
      return;
    }
    if (pending.length === 0) {
      await showEmptyInbox(ctx, watcher);
      return;
    }

    const labels = pending.map(message => `${formatTimestamp(message.created_at)}  ${preview(message.message)}`);
    labels.push("Close");
    const selected = await ctx.ui.select(`Pi session inbox (${pending.length} pending)`, labels);
    if (!selected || selected === "Close") return;
    const index = labels.indexOf(selected);
    const summary = pending[index];
    if (!summary) return;

    const message = await showInboxMessage(controller, ctx, sessionId, summary.message_id);
    if (!message) continue;
    const action = await ctx.ui.select(
      `Inbox message\n\n${message.message}`,
      ["Accept and send", "Ignore", "Back"],
    );
    if (action === "Accept and send") {
      if (await deliverInboxMessage(controller, ctx, sessionId, summary.message_id)) {
        ctx.ui.notify("Inbox message accepted and sent to the Pi session.", "info");
      }
    } else if (action === "Ignore") {
      const ignored = await transitionInboxMessage(controller, sessionId, summary.message_id, "ignore");
      if (ignored) ctx.ui.notify("Inbox message ignored.", "info");
    }
  }
}

async function listInboxMessages(
  controller: InboxController,
  ctx: ExtensionCommandContext,
  sessionId: string,
  watcher: InboxWatcherHandle | null,
): Promise<void> {
  const messages = await getInboxMessages(controller, sessionId, "all");
  if (!messages) {
    ctx.ui.notify("Unable to read the Pi session inbox", "error");
    return;
  }
  if (messages.length === 0) {
    await showEmptyInbox(ctx, watcher);
    return;
  }
  const output = messages.map(message => [
    `${message.status}  ${message.message_id}`,
    `${formatTimestamp(message.created_at)}  ${message.message ?? ""}`,
  ].join("\n")).join("\n\n");
  await showOutputPanel(ctx, "Pi Session Inbox", output);
}

async function showInboxMessage(controller: InboxController, ctx: ExtensionCommandContext, sessionId: string, messageID: string): Promise<InboxMessage | null> {
  const result = await controller.runGscCommand(
    "pi", "sessions", "inbox", "show", "--session-id", sessionId, "--id", messageID,
  );
  if (!result || result.code !== 0) {
    ctx.ui.notify(commandFailure(result, "Unable to load inbox message"), "error");
    return null;
  }
  try {
    const message = parseInboxMessage(result.stdout);
    return message;
  } catch (error) {
    ctx.ui.notify(`Invalid inbox response: ${formatError(error)}`, "error");
    return null;
  }
}

async function transitionInboxMessage(controller: InboxController, sessionId: string, messageID: string, action: "accept" | "ignore"): Promise<InboxMessage | null> {
  const result = await controller.runGscCommand(
    "pi", "sessions", "inbox", action, "--session-id", sessionId, "--id", messageID,
  );
  if (!result || result.code !== 0) return null;
  try {
    return parseInboxMessage(result.stdout);
  } catch {
    return null;
  }
}

async function deliverInboxMessage(
  controller: InboxController,
  ctx: ExtensionContext,
  sessionId: string,
  messageID: string,
): Promise<boolean> {
  const claim = await runInboxTransition(controller, sessionId, messageID, "claim");
  if (!claim?.message || !claim.delivery_id) return false;
  try {
    controller.sendUserMessage(
      claim.message,
      ctx.isIdle() ? undefined : { deliverAs: "followUp" },
    );
    const completed = await controller.runGscCommand(
      "pi", "sessions", "inbox", "complete",
      "--session-id", sessionId,
      "--id", messageID,
      "--delivery-id", claim.delivery_id,
    );
    if (!completed || completed.code !== 0) throw new Error("delivery acknowledgement failed");
    return true;
  } catch {
    await controller.runGscCommand(
      "pi", "sessions", "inbox", "release",
      "--session-id", sessionId,
      "--id", messageID,
      "--delivery-id", claim.delivery_id,
    );
    return false;
  }
}

async function runInboxTransition(
  controller: InboxController,
  sessionId: string,
  messageID: string,
  action: "claim",
): Promise<InboxMessage | null> {
  const result = await controller.runGscCommand(
    "pi", "sessions", "inbox", action,
    "--session-id", sessionId,
    "--id", messageID,
  );
  if (!result || result.code !== 0) return null;
  try {
    return parseInboxMessage(result.stdout);
  } catch {
    return null;
  }
}

async function getInboxMessages(controller: InboxController, sessionId: string, status: "pending" | "all"): Promise<InboxMessage[] | null> {
  const result = await controller.runGscCommand(
    "pi", "sessions", "inbox", "list", "--session-id", sessionId, "--status", status,
  );
  if (!result || result.code !== 0) return null;
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (!isRecord(parsed) || !Array.isArray(parsed.messages)) throw new Error("expected messages array");
    return parsed.messages.filter(isInboxMessage);
  } catch {
    return null;
  }
}

export function startInboxWatcher(
  controller: InboxController,
  ctx: ExtensionContext,
  options: { pollIntervalMs?: number; initialAutoAccept?: boolean; onAutoAcceptChange?: (enabled: boolean) => void } = {},
): InboxWatcherHandle {
  if (ctx.mode !== "tui") {
    return { stop() {}, setAutoAccept() {}, isAutoAcceptEnabled: () => false };
  }
  let stopped = false;
  let inFlight = false;
  let initialized = false;
  let autoAccept = options.initialAutoAccept ?? false;
  const seen = new Set<string>();
  const autoFailureNotices = new Set<string>();
  const poll = async (): Promise<void> => {
    if (stopped || inFlight) return;
    const sessionId = controller.getSessionId();
    if (!sessionId) return;
    inFlight = true;
    try {
      const result = await controller.runGscCommand(
        "pi", "sessions", "inbox", "poll", "--session-id", sessionId,
      );
      if (!result || result.code !== 0 || stopped) return;
      const parsed = parseInboxPoll(result.stdout);
      const newMessages = parsed.filter(message => message.status === "pending" && !seen.has(message.message_id));
      parsed.forEach(message => seen.add(message.message_id));
      if (autoAccept) {
        for (const message of parsed) {
          if (message.status !== "pending" && message.status !== "delivering") continue;
          const delivered = await deliverInboxMessage(controller, ctx, sessionId, message.message_id);
          if (delivered) {
            autoFailureNotices.delete(message.message_id);
            ctx.ui.notify("Inbox message auto-accepted and sent to the Pi session.", "info");
          } else if (!autoFailureNotices.has(message.message_id)) {
            autoFailureNotices.add(message.message_id);
            ctx.ui.notify("Inbox auto-accept failed; the message will be retried.", "warning");
          }
        }
      } else if (initialized && newMessages.length > 0) {
        const suffix = newMessages.length === 1 ? "message" : "messages";
        ctx.ui.notify(`New ${suffix} in the Pi session inbox. Run /brains inbox to review.`, "info");
      }
      initialized = true;
    } catch {
      // The explicit /brains inbox command reports read errors. The background
      // notice must remain quiet when gsc is unavailable or temporarily busy.
    } finally {
      inFlight = false;
    }
  };
  void poll();
  const timer = setInterval(() => { void poll(); }, options.pollIntervalMs ?? DEFAULT_INBOX_POLL_INTERVAL_MS);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    setAutoAccept(enabled: boolean) {
      autoAccept = enabled;
      options.onAutoAcceptChange?.(enabled);
    },
    isAutoAcceptEnabled() {
      return autoAccept;
    },
  };
}

function parseInboxPoll(value: string): InboxMessage[] {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || !Array.isArray(parsed.messages)) throw new Error("expected messages array");
  return parsed.messages.filter(isInboxMessage);
}

function parseInboxMessage(value: string): InboxMessage {
  const parsed: unknown = JSON.parse(value);
  if (!isInboxMessage(parsed)) throw new Error("expected a valid inbox message");
  return parsed;
}

function isInboxMessage(value: unknown): value is InboxMessage {
  if (!isRecord(value)) return false;
  return typeof value.message_id === "string" && typeof value.session_id === "string"
    && (value.status === "pending" || value.status === "delivering" || value.status === "accepted" || value.status === "ignored")
    && typeof value.created_at === "string";
}

function preview(message: string | undefined): string {
  const value = (message ?? "").replaceAll(/\s+/g, " ").trim();
  return value.length > 72 ? `${value.slice(0, 69)}…` : value;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function commandFailure(result: GscCommandResult | null, fallback: string): string {
  return result?.stderr.trim() || result?.stdout.trim() || fallback;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
