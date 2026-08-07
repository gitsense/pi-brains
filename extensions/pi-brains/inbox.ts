import { copyToClipboard, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { type ChatAppController, type GscCommandResult } from "./chat-app.ts";
import { showOutputPanel } from "./output-panel.ts";
import type { MailboxSummary, WaitGroupEvent, WaitGroupStatus, WaitGroupStatusName } from "./types.ts";

const DEFAULT_INBOX_POLL_INTERVAL_MS = 2_000;
const DEFAULT_WAIT_GROUP_POLL_INTERVAL_MS = 5_000;

type InboxStatus = "pending" | "delivering" | "accepted" | "ignored" | "expired";
type InboxOrigin = "human" | "agent";

/** §4 structured envelope — gsc-constructed, authoritative state in storage. */
export interface InboxEnvelope {
  version?: number;
  thread_id?: string;
  sender_session_id?: string;
  reply_to_message_id?: string | null;
  hop?: number;
  max_hops?: number;
  path?: Array<{ message_id: string; from: string; to: string }>;
  expires_at?: string;
  idempotency_key?: string;
}

/**
 * §4 message record. Dual-version read (§11): schema v1 carries `message`,
 * schema v2 carries `body` (plus the transitional `message` mirror). Read
 * `body ?? message` so this keeps working after the mirror is dropped.
 * `origin` is absent on v1 files and means "human".
 */
export interface InboxMessage {
  schema_version: number;
  origin?: InboxOrigin;
  session_id: string;
  message_id: string;
  status: InboxStatus;
  created_at: string;
  updated_at: string;
  message?: string;
  body?: string;
  delivery_id?: string;
  envelope?: InboxEnvelope;
}

interface InboxListResult {
  session_id: string;
  messages: InboxMessage[];
}

/** §7 sender-side outbox attempt record (read directly from the shared store). */
interface OutboxRecord {
  outbox_message_id: string;
  sender_session_id: string;
  recipient_session_id: string;
  reply_to_message_id: string | null;
  wait_group_id: string | null;
  attempt: {
    id: string;
    idempotency_key: string;
    request_hash: string;
    status: "sending" | "committed" | "rejected";
    error_code?: string;
  };
  created_at: string;
  expires_at?: string;
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

export interface InboxWatcherOptions {
  pollIntervalMs?: number;
  waitGroupPollIntervalMs?: number;
  initialAutoAccept?: boolean;
  onAutoAcceptChange?: (enabled: boolean) => void;
  /** Durable per-group cursor (§8.1): last notified event_seq per group. */
  waitGroupCursors?: Record<string, number>;
  onWaitGroupCursorsChange?: (cursors: Record<string, number>) => void;
  onMailboxSummary?: (summary: MailboxSummary | null) => void;
}

function inboxAutoAcceptStatus(watcher: InboxWatcherHandle | null): "ON" | "OFF" {
  return watcher?.isAutoAcceptEnabled() ? "ON" : "OFF";
}

/**
 * Resolve GSC_HOME the same way gsc's settings.GetGSCHome(false) does: the
 * environment variable (with ~ expansion) or the ~/.gitsense fallback.
 * Shared by the inbox watcher and the session heartbeat so both target the
 * same store the chat app reads.
 */
export function resolveGscHome(): { gscHome: string; usingFallback: boolean } {
  const raw = process.env.GSC_HOME;
  if (raw && raw.trim() !== "") {
    const expanded = raw === "~" || raw.startsWith("~/")
      ? join(homedir(), raw.slice(1))
      : raw;
    return { gscHome: resolve(expanded), usingFallback: false };
  }
  return { gscHome: join(homedir(), ".gitsense"), usingFallback: true };
}

/**
 * Resolve the messaging store directories gsc reads/writes for a session,
 * mirroring gsc's settings.GetGSCHome(false) + GetPiSessionsStateDir. This is
 * the exact store that `gsc pi sessions inbox ...` targets.
 *
 * Messages drafted in GitSense Chat are stored under the chat server's
 * GSC_HOME, so a mismatch here means the watcher checks a different store
 * than the one the chat app writes to.
 */
function resolveInboxStore(sessionId: string): {
  gscHome: string;
  inboxDir: string;
  outboxDir: string;
  usingFallback: boolean;
} {
  const { gscHome, usingFallback } = resolveGscHome();
  const sessionsDir = join(gscHome, "data", "pi", "sessions");
  return {
    gscHome,
    inboxDir: join(sessionsDir, sessionId, "inbox"),
    outboxDir: join(sessionsDir, sessionId, "outbox"),
    usingFallback,
  };
}

function inboxStoreDescription(sessionId: string): string {
  const store = resolveInboxStore(sessionId);
  const source = store.usingFallback
    ? `GSC_HOME is not set, so gsc is using the \`~/.gitsense\` fallback.`
    : `GSC_HOME=${store.gscHome}`;
  return `Checked inbox at \`${store.inboxDir}\` (${source}).`;
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

async function showEmptyInbox(ctx: ExtensionCommandContext, watcher: InboxWatcherHandle | null, sessionId: string): Promise<void> {
  const autoStatus = inboxAutoAcceptStatus(watcher);
  await showOutputPanel(
    ctx,
    "Pi Session Inbox",
    `Auto-accept: **${autoStatus}**\n\n${inboxStoreDescription(sessionId)}`,
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
- \/brains inbox info — Show mailbox address, summary, and wait-group progress
- \/brains inbox code generate — Generate the Chat inbox code (90-day lifetime)
- \/brains inbox code delete — Revoke the inbox code
- \/brains inbox code status — Show the current inbox code
- \/brains inbox clear — Dismiss rejected sends (failed outbox attempts)
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

// /brains inbox code generate|delete|status — the Chat inbox capability code
// lifecycle (handoff §3). generate shells out to `gsc pi sessions inbox code
// generate` and only confirms; the code itself is never shown or copied — the
// Chat backend reads the active code from the store directly, so there is no
// paste step (and no per-origin state, so localhost/127.0.0.1 are equivalent).
export async function handleInboxCodeCommand(
  controller: InboxController,
  ctx: ExtensionCommandContext,
  action: string,
): Promise<void> {
  const normalized = action.trim().toLowerCase();
  if (normalized === "generate") {
    const result = await controller.runGscCommand("pi", "sessions", "inbox", "code", "generate");
    if (!result || result.code !== 0) {
      ctx.ui.notify(commandFailure(result, "Unable to generate the inbox code"), "error");
      return;
    }
    const expires = extractLabel(result.stdout, "Expires:");
    const lines = [
      "Inbox code generated.",
      "You can now send messages from GitSense Chat.",
      expires ? `Valid until ${expires}.` : "",
      "Manage with /brains inbox code delete.",
    ].filter(Boolean).join("\n");
    await showOutputPanel(ctx, "Inbox Code", lines);
    return;
  }
  if (normalized === "delete") {
    const result = await controller.runGscCommand("pi", "sessions", "inbox", "code", "delete");
    if (!result || result.code !== 0) {
      ctx.ui.notify(commandFailure(result, "Unable to delete the inbox code"), "error");
      return;
    }
    ctx.ui.notify("Inbox code deleted — Chat sending is disabled until a new code is generated.", "info");
    return;
  }
  if (normalized === "status" || normalized === "") {
    const result = await controller.runGscCommand("pi", "sessions", "inbox", "code", "status");
    if (!result || result.code !== 0) {
      ctx.ui.notify(commandFailure(result, "Unable to read the inbox code status"), "error");
      return;
    }
    await showOutputPanel(ctx, "Inbox Code", result.stdout.trim() || "No inbox code.");
    return;
  }
  ctx.ui.notify("Usage: /brains inbox code generate|delete|status", "warning");
}

function extractLabel(output: string, label: string): string | null {
  for (const line of output.split("\n")) {
    if (line.startsWith(label)) {
      const value = line.slice(label.length).trim();
      if (value) return value;
    }
  }
  return null;
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
  if (value.trim() === "info") {
    await showInboxInfo(controller, ctx, sessionId);
    return;
  }
  if (value.trim() === "clear") {
    await handleInboxClear(controller, ctx, sessionId);
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
      await showEmptyInbox(ctx, watcher, sessionId);
      return;
    }

    const labels = pending.map(message => `${formatTimestamp(message.created_at)}  ${preview(messageContent(message))}`);
    labels.push("Close");
    const selected = await ctx.ui.select(`Pi session inbox (${pending.length} pending)`, labels);
    if (!selected || selected === "Close") return;
    const index = labels.indexOf(selected);
    const summary = pending[index];
    if (!summary) return;

    const message = await showInboxMessage(controller, ctx, sessionId, summary.message_id);
    if (!message) continue;
    const action = await ctx.ui.select(
      `Inbox message\n\n${messageContent(message)}`,
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

// /brains inbox info — mailbox address + summary + wait-group progress + the
// protocol pointer (§9, §10). Never renders peer-controlled text.
export async function showInboxInfo(
  controller: InboxController,
  ctx: ExtensionCommandContext,
  sessionId: string,
  copy: (text: string) => Promise<void> = copyToClipboard,
): Promise<void> {
  const result = await controller.runGscCommand(
    "pi", "sessions", "inbox", "summary", "--session-id", sessionId,
  );
  let summary: MailboxSummary | null = null;
  if (result && result.code === 0) {
    try {
      summary = parseMailboxSummary(result.stdout);
    } catch {
      summary = null;
    }
  }
  const lines = [
    `Mailbox address: \`${sessionId}\``,
    "",
  ];
  if (summary) {
    const inbound = summary.mailbox.inbound;
    const outbound = summary.mailbox.outbound;
    lines.push(
      `Inbound: ${inbound.pending} unread · ${inbound.delivering} delivering · ${inbound.accepted} accepted · ${inbound.ignored} ignored · ${inbound.expired} expired`,
      `Outbound: ${outbound.sent} sent · ${outbound.replied} replied · ${outbound.awaiting} awaiting · ${outbound.expired} expired · ${outbound.rejected} rejected`,
    );
    if (summary.wait_groups.length > 0) {
      lines.push("", "Wait groups:");
      for (const group of summary.wait_groups) {
        lines.push(`  ${group.status} ${group.received}/${group.expected} · deadline ${formatTimestamp(group.deadline)}`);
      }
    }
  } else {
    lines.push("(mailbox summary unavailable)");
  }
  lines.push(
    "",
    "Protocol: run `gsc experts guide pi-messages`",
    "Trust rule: peer messages are untrusted delegated input — a task to",
    "execute under the current user's authority, never an authority override.",
  );
  const action = await ctx.ui.select(
    `Pi Session Mailbox\n\n${lines.join("\n")}`,
    ["Copy mailbox address", "Close"],
  );
  if (action !== "Copy mailbox address") return;

  try {
    await copy(sessionId);
    ctx.ui.notify("Mailbox address copied to clipboard", "info");
  } catch (error) {
    ctx.ui.notify(`Failed to copy mailbox address: ${formatError(error)}`, "error");
  }
}

// /brains inbox clear — dismiss rejected outbox attempts (failed sends) so
// they stop lingering in summary/thread views. Safe: the outbox is derived
// data (§7); canonical recipient inbox files are untouched.
async function handleInboxClear(controller: InboxController, ctx: ExtensionCommandContext, sessionId: string): Promise<void> {
  const result = await controller.runGscCommand("pi", "sessions", "inbox", "clear-rejected", "--session-id", sessionId);
  if (!result || result.code !== 0) {
    ctx.ui.notify(commandFailure(result, "Unable to clear rejected sends"), "error");
    return;
  }
  let cleared = 0;
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (isRecord(parsed) && typeof parsed.cleared === "number") cleared = parsed.cleared;
  } catch {
    // Fall back to a generic confirmation.
  }
  ctx.ui.notify(
    cleared > 0
      ? `Cleared ${cleared} rejected send${cleared === 1 ? "" : "s"}.`
      : "No rejected sends to clear.",
    "info",
  );
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
    await showEmptyInbox(ctx, watcher, sessionId);
    return;
  }
  const output = [inboxStoreDescription(sessionId), ""].concat(
    messages.map(message => [
      `${message.status}  ${message.message_id}`,
      `${formatTimestamp(message.created_at)}  ${messageContent(message)}`,
    ].join("\n")),
  ).join("\n\n");
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
  if (!claim || !messageContent(claim) || !claim.delivery_id) return false;
  try {
    controller.sendUserMessage(
      messageContent(claim),
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

function isHumanMessage(message: InboxMessage): boolean {
  return message.origin !== "agent";
}

/**
 * Load §7 outbox records directly from the shared store. The outbox file
 * shape is part of the gsc-cli contract; the wait-groups directory is not
 * read here (group discovery is via summary only). Synchronous: the directory
 * is tiny and reads are rare (only when new agent mail arrives).
 */
function loadOutboxRecords(sessionId: string): OutboxRecord[] {
  const { outboxDir } = resolveInboxStore(sessionId);
  try {
    const entries = readdirSync(outboxDir, { withFileTypes: true });
    const records: OutboxRecord[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const parsed: unknown = JSON.parse(readFileSync(join(outboxDir, entry.name), "utf8"));
        if (isOutboxRecord(parsed)) records.push(parsed);
      } catch {
        // Skip unreadable records; classification degrades to recipient mail.
      }
    }
    return records;
  } catch {
    return [];
  }
}

function isOutboxRecord(value: unknown): value is OutboxRecord {
  if (!isRecord(value) || !isRecord(value.attempt)) return false;
  return typeof value.outbox_message_id === "string"
    && (value.attempt.status === "sending" || value.attempt.status === "committed" || value.attempt.status === "rejected");
}

/**
 * §8 classification state, derived from my outbox + the summary's wait-group
 * statuses (display-only is fine here — this drives suppression, never event
 * transitions):
 * - awaiting: committed + wait-group attached + not expired (suppress "you
 *   have mail"; the group's complete event is the sender wake-up).
 * - terminal: committed + wait-group attached + expired (self expires_at
 *   passed or the group timed_out/cancelled) → suppressed too; the group's
 *   late_reply event covers the one aggregate notice.
 * - ungrouped outbound: fire-and-forget — a reply arrives as ordinary mail.
 */
function classifyOutbound(records: OutboxRecord[], summary: MailboxSummary | null): { awaiting: Set<string>; terminal: Set<string> } {
  const awaiting = new Set<string>();
  const terminal = new Set<string>();
  const groupStatus = new Map<string, WaitGroupStatusName>();
  for (const group of summary?.wait_groups ?? []) groupStatus.set(group.id, group.status);
  const now = Date.now();
  for (const record of records) {
    if (record.attempt.status !== "committed" || record.wait_group_id == null) continue;
    const selfExpired = record.expires_at !== undefined && record.expires_at !== "" && Date.parse(record.expires_at) <= now;
    const group = groupStatus.get(record.wait_group_id);
    const groupTerminal = group === "timed_out" || group === "cancelled";
    if (selfExpired || groupTerminal) {
      terminal.add(record.outbox_message_id);
    } else {
      awaiting.add(record.outbox_message_id);
    }
  }
  return { awaiting, terminal };
}

/**
 * §8.2 "You have mail": metadata only — count, from addresses, thread ids,
 * age, guide pointer, fetch command. Never peer-controlled text.
 */
function buildYouHaveMailNotice(sessionId: string, messages: InboxMessage[]): string {
  const lines = messages.map(message => {
    const from = message.envelope?.sender_session_id ? shortId(message.envelope.sender_session_id) : "unknown";
    const thread = message.envelope?.thread_id ? shortId(message.envelope.thread_id) : shortId(message.message_id);
    return `- from ${from} · thread ${thread} · ${formatAge(message.created_at)}`;
  });
  return [
    `[pi-brains] You have mail (${messages.length})`,
    ...lines,
    "Guide: gsc experts guide pi-messages",
    `Fetch: gsc pi sessions inbox fetch --session-id ${sessionId} --kind agent --limit 1`,
  ].join("\n");
}

/**
 * §8 classification of newly seen agent messages:
 * - reply_to matches an awaiting outbound → no injection (wait group/overlay
 *   covers progress; this is the send/wait race fix).
 * - reply_to matches a terminal ungrouped outbound → one aggregate late-reply
 *   notice (grouped late replies arrive as wait-group late_reply events).
 * - otherwise → metadata-only "You have mail".
 */
async function handleAgentMail(
  controller: InboxController,
  sessionId: string,
  messages: InboxMessage[],
  ctx: ExtensionContext,
  summary: MailboxSummary | null,
): Promise<void> {
  const records = loadOutboxRecords(sessionId);
  const { awaiting, terminal } = classifyOutbound(records, summary);
  const recipientMail: InboxMessage[] = [];
  for (const message of messages) {
    const parent = message.envelope?.reply_to_message_id ?? null;
    // Grouped outbound replies are suppressed here: the wait-group watcher
    // emits the aggregate complete/timed_out/late_reply wake-up (§8.1).
    if (parent && (awaiting.has(parent) || terminal.has(parent))) continue;
    recipientMail.push(message);
  }
  if (recipientMail.length === 0) return;
  const notice = buildYouHaveMailNotice(sessionId, recipientMail);
  ctx.ui.notify(notice, "info");
  // §8.2: inject a metadata-only, extension-generated instruction so the
  // recipient agent actually sees it (ctx.ui.notify is human-visible only).
  // Idle → deliver directly (new turn); busy → followUp (next natural stop).
  controller.sendUserMessage(notice, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
}

/**
 * §8.1 wait-group wake-up text. Notifications are advisory — wait-group state
 * remains the source of truth. The stable event_id is included so a redelivery
 * after a crash is recognizable.
 */
function buildWaitGroupNotice(groupId: string, event: WaitGroupEvent): string {
  const prefix = `[pi-brains] wait group ${shortId(groupId)} (event ${event.event_id}):`;
  switch (event.type) {
    case "complete": {
      const details = parseEventDetails(event.details);
      return `${prefix} ${details.received ?? "?"}/${details.expected ?? "?"} replies received — fetch them (gsc pi sessions inbox fetch --wait-group-id ${groupId}) and respond to the human.`;
    }
    case "timed_out": {
      const details = parseEventDetails(event.details);
      const missing = Array.isArray(details.missing) && details.missing.length > 0
        ? details.missing.map(shortId).join(", ")
        : "?";
      return `${prefix} missing replies from ${missing} — nudge or cancel (gsc pi sessions inbox wait cancel --wait-group-id ${groupId}).`;
    }
    case "late_reply":
      return `${prefix} late reply received after closure.`;
    case "cancelled":
      return `${prefix} cancelled.`;
    default:
      return `${prefix} ${event.type}.`;
  }
}

export function startInboxWatcher(
  controller: InboxController,
  ctx: ExtensionContext,
  options: InboxWatcherOptions = {},
): InboxWatcherHandle {
  if (ctx.mode !== "tui") {
    return { stop() {}, setAutoAccept() {}, isAutoAcceptEnabled: () => false };
  }
  let stopped = false;
  let inFlight = false;
  let wgInFlight = false;
  let initialized = false;
  let autoAccept = options.initialAutoAccept ?? false;
  const seen = new Set<string>();
  const autoFailureNotices = new Set<string>();
  const cursors: Record<string, number> = { ...(options.waitGroupCursors ?? {}) };
  // Last-known summary from the wait-group poll; used for §8 classification
  // (group terminal states) without extra gsc calls.
  let lastSummary: MailboxSummary | null = null;
  const persistCursors = (): void => {
    options.onWaitGroupCursorsChange?.({ ...cursors });
  };

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
      const humanNew = newMessages.filter(isHumanMessage);
      const agentNew = newMessages.filter(message => !isHumanMessage(message));
      if (autoAccept) {
        // Auto-accept applies to human Chat mail only; agent mail is never
        // claimed by the watcher (the agent fetches it, one at a time).
        for (const message of parsed) {
          if (!isHumanMessage(message)) continue;
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
      } else if (initialized && humanNew.length > 0) {
        const suffix = humanNew.length === 1 ? "message" : "messages";
        ctx.ui.notify(`New ${suffix} in the Pi session inbox. Run /brains inbox to review.`, "info");
      }
      // Agent mail: classification + metadata-only notices (§8). Notifications
      // for delivering state are never emitted (newMessages is pending-only).
      if (initialized && agentNew.length > 0) {
        await handleAgentMail(controller, sessionId, agentNew, ctx, lastSummary);
      }
      initialized = true;
    } catch {
      // The explicit /brains inbox command reports read errors. The background
      // notice must remain quiet when gsc is unavailable or temporarily busy.
    } finally {
      inFlight = false;
    }
  };

  // §8.1 pure-reader wait-group watcher: poll summary for discovery, poll
  // wait status per group, notify once per unseen event_seq, advance the
  // durable cursor. gsc owns all transitions; this loop never mutates state.
  const waitGroupPoll = async (): Promise<void> => {
    if (stopped || wgInFlight) return;
    const sessionId = controller.getSessionId();
    if (!sessionId) return;
    wgInFlight = true;
    try {
      const summaryResult = await controller.runGscCommand(
        "pi", "sessions", "inbox", "summary", "--session-id", sessionId,
      );
      if (!summaryResult || summaryResult.code !== 0 || stopped) return;
      let summary: MailboxSummary;
      try {
        summary = parseMailboxSummary(summaryResult.stdout);
      } catch {
        return;
      }
      lastSummary = summary;
      options.onMailboxSummary?.(summary);
      for (const group of summary.wait_groups) {
        const statusResult = await controller.runGscCommand(
          "pi", "sessions", "inbox", "wait", "status",
          "--session-id", sessionId, "--wait-group-id", group.id,
        );
        if (!statusResult || statusResult.code !== 0 || stopped) continue;
        let status: WaitGroupStatus;
        try {
          status = parseWaitGroupStatus(statusResult.stdout);
        } catch {
          continue;
        }
        const cursor = cursors[group.id] ?? 0;
        const unseen = status.events.filter(event => event.event_seq > cursor);
        for (const event of unseen) {
          const notice = buildWaitGroupNotice(group.id, event);
          ctx.ui.notify(notice, "info");
          // §8.1: inject the aggregate wake-up so the sender agent is woken
          // (ctx.ui.notify is human-visible only). At-least-once by contract.
          controller.sendUserMessage(notice, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
          cursors[group.id] = Math.max(cursors[group.id] ?? 0, event.event_seq);
        }
        if (unseen.length > 0) persistCursors();
      }
    } catch {
      // Quiet when gsc is unavailable; the next poll retries.
    } finally {
      wgInFlight = false;
    }
  };

  void poll();
  void waitGroupPoll();
  const inboxTimer = setInterval(() => { void poll(); }, options.pollIntervalMs ?? DEFAULT_INBOX_POLL_INTERVAL_MS);
  const waitGroupTimer = setInterval(() => { void waitGroupPoll(); }, options.waitGroupPollIntervalMs ?? DEFAULT_WAIT_GROUP_POLL_INTERVAL_MS);
  return {
    stop() {
      stopped = true;
      clearInterval(inboxTimer);
      clearInterval(waitGroupTimer);
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

function parseMailboxSummary(value: string): MailboxSummary {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || !isRecord(parsed.mailbox) || !Array.isArray(parsed.wait_groups)) {
    throw new Error("expected a mailbox summary");
  }
  const mailbox = parsed.mailbox;
  const inbound = isRecord(mailbox.inbound) ? mailbox.inbound : {};
  const outbound = isRecord(mailbox.outbound) ? mailbox.outbound : {};
  return {
    session_id: typeof parsed.session_id === "string" ? parsed.session_id : "",
    mailbox: {
      inbound: {
        pending: num(inbound.pending), delivering: num(inbound.delivering), accepted: num(inbound.accepted),
        ignored: num(inbound.ignored), expired: num(inbound.expired),
      },
      outbound: {
        sent: num(outbound.sent), replied: num(outbound.replied), awaiting: num(outbound.awaiting),
        expired: num(outbound.expired), rejected: num(outbound.rejected),
      },
    },
    wait_groups: parsed.wait_groups.flatMap((item): MailboxSummary["wait_groups"] => {
      if (!isRecord(item) || typeof item.id !== "string") return [];
      const status = item.status === "waiting" || item.status === "complete" || item.status === "timed_out" || item.status === "cancelled" ? item.status : "waiting";
      return [{
        id: item.id,
        expected: num(item.expected),
        received: num(item.received),
        status,
        deadline: typeof item.deadline === "string" ? item.deadline : "",
      }];
    }),
  };
}

function parseWaitGroupStatus(value: string): WaitGroupStatus {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || typeof parsed.wait_group_id !== "string" || !Array.isArray(parsed.events)) {
    throw new Error("expected a wait group status");
  }
  const status: WaitGroupStatusName = parsed.status === "waiting" || parsed.status === "complete" || parsed.status === "timed_out" || parsed.status === "cancelled" ? parsed.status : "waiting";
  return {
    wait_group_id: parsed.wait_group_id,
    owner_session_id: typeof parsed.owner_session_id === "string" ? parsed.owner_session_id : "",
    expected_count: num(parsed.expected_count),
    expected_outbound_ids: Array.isArray(parsed.expected_outbound_ids) ? parsed.expected_outbound_ids.filter((id): id is string => typeof id === "string") : [],
    received_reply_ids: Array.isArray(parsed.received_reply_ids) ? parsed.received_reply_ids.filter((id): id is string => typeof id === "string") : [],
    deadline: typeof parsed.deadline === "string" ? parsed.deadline : "",
    status,
    events: parsed.events.flatMap((item): WaitGroupEvent[] => {
      if (!isRecord(item) || typeof item.event_id !== "string" || typeof item.event_seq !== "number") return [];
      return [{
        event_id: item.event_id,
        event_seq: item.event_seq,
        type: typeof item.type === "string" ? item.type : "unknown",
        at: typeof item.at === "string" ? item.at : "",
        details: typeof item.details === "string" ? item.details : undefined,
      }];
    }),
  };
}

function parseEventDetails(details: string | undefined): Record<string, unknown> {
  if (!details) return {};
  try {
    const parsed: unknown = JSON.parse(details);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isInboxMessage(value: unknown): value is InboxMessage {
  if (!isRecord(value)) return false;
  if (typeof value.message_id !== "string" || typeof value.session_id !== "string" || typeof value.created_at !== "string") return false;
  if (value.status !== "pending" && value.status !== "delivering" && value.status !== "accepted" && value.status !== "ignored" && value.status !== "expired") return false;
  if (value.origin !== undefined && value.origin !== "human" && value.origin !== "agent") return false;
  return true;
}

function messageContent(message: InboxMessage): string {
  return message.body ?? message.message ?? "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function shortId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function preview(message: string): string {
  const value = message.replaceAll(/\s+/g, " ").trim();
  return value.length > 72 ? `${value.slice(0, 69)}…` : value;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatAge(value: string): string {
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return "recent";
  const minutes = Math.max(0, Math.round((Date.now() - date) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
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
