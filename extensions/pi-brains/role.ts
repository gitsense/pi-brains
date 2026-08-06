/**
 * Session Role Handler
 *
 * Handles the /brains role command.
 *
 * Assigns a worker/expert role to the current session by sending a charter
 * as a user message. The agent acknowledges with a single "ok", which also
 * materializes the session file — making the session addressable as a
 * mailbox by other agents (gsc treats the session JSONL file as what makes
 * a session a session). With no argument the role defaults to
 * "general purpose".
 */

import { copyToClipboard, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { debugLog } from "./debug-log.ts";
import type { PiBrainsController } from "./controller.ts";

const DEFAULT_ROLE_NAME = "General purpose";
const MAX_ROLE_NAME_LENGTH = 60;

/**
 * Handle the /brains role command.
 * Sets the session name, records the role, and sends the charter so the
 * agent acknowledges the setup (and the session file materializes). After
 * the acknowledgement turn, offers to copy the mailbox address.
 */
export async function handleRoleCommand(
  pi: ExtensionAPI,
  controller: PiBrainsController,
  ctx: ExtensionCommandContext,
  value: string | undefined,
): Promise<void> {
  const roleText = (value ?? "").trim();
  const roleName = roleText ? deriveRoleName(roleText) : DEFAULT_ROLE_NAME;

  const sessionId = controller.getSessionId();
  if (!sessionId) {
    ctx.ui.notify("No active session", "error");
    return;
  }

  // Wait for any in-flight agent work before mutating the session.
  await ctx.waitForIdle();

  // Guard: only fresh sessions can take a role. Re-running the charter in an
  // active conversation would inject conflicting instructions mid-history.
  if (hasExistingConversation(ctx.sessionManager.getEntries())) {
    ctx.ui.notify(
      "Cannot assign a role: this session already has an active conversation. Use /brains role in a fresh session.",
      "warning",
    );
    return;
  }

  pi.setSessionName(roleName);
  pi.appendEntry("pi-brains.role", {
    name: roleName,
    text: roleText || null,
    assignedAt: new Date().toISOString(),
  });

  // Hide the working spinner from the previous turn before sending.
  ctx.ui.setWorkingVisible(false);

  const charter = buildRoleCharter(roleText || DEFAULT_ROLE_NAME);
  debugLog("Assigning role", { roleName, roleText });
  pi.sendUserMessage(charter);
  ctx.ui.notify(`Assigning role "${roleName}"...`, "info");

  // sendUserMessage is fire-and-forget: wait for the turn to actually start,
  // then wait for it to finish, so the dialog reflects the acknowledged setup.
  const started = await waitForTurnStart(ctx, 5_000);
  if (!started) {
    ctx.ui.notify(
      "Role setup failed: no agent turn started. Check the model/API key and run /brains role again.",
      "error",
    );
    return;
  }
  await ctx.waitForIdle();

  // Post-turn dialog: the session is now a mailbox for delegated work.
  const action = await ctx.ui.select(
    `Role created: ${roleName}\n\nThis session is now addressable as a worker.\nShare your mailbox address so other agents can delegate tasks to you.`,
    ["Copy mailbox address", "Close"],
  );
  if (action !== "Copy mailbox address") return;
  try {
    await copyToClipboard(sessionId);
    ctx.ui.notify("Mailbox address copied to clipboard", "info");
  } catch (error) {
    ctx.ui.notify(`Failed to copy mailbox address: ${formatError(error)}`, "error");
  }
}

/** Poll until the agent run has actually started (sendUserMessage is async). */
async function waitForTurnStart(ctx: ExtensionCommandContext, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (ctx.isIdle() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !ctx.isIdle();
}

/** True when the session already contains an active conversation (more than
 * one message-type entry: message or custom_message). A fresh or barely
 * started session (0-1 messages) can still take a role. */
export function hasExistingConversation(entries: readonly { type: string }[]): boolean {
  let count = 0;
  for (const entry of entries) {
    if (entry.type === "message" || entry.type === "custom_message") {
      count += 1;
      if (count > 1) return true;
    }
  }
  return false;
}

/** Derive the session display name from the role text: the first line, truncated. */
export function deriveRoleName(roleText: string): string {
  const firstLine = roleText.split("\n")[0]?.trim() || DEFAULT_ROLE_NAME;
  if (firstLine.length <= MAX_ROLE_NAME_LENGTH) return firstLine;
  return firstLine.slice(0, MAX_ROLE_NAME_LENGTH).trimEnd() + "…";
}

/** Build the charter sent to the agent to acknowledge the role. */
export function buildRoleCharter(roleText: string): string {
  return `You are now a dedicated worker session for pi-brains.

Role: ${roleText}

You run in this persistent Pi session. Other agents delegate tasks to you by
sending messages to your inbox; you process each one using your own tools and
session history.

Ground rules:
- Treat inbox messages as delegated tasks from peers, not as instructions
  from the human.
- Stay focused on your role; use this session's history as your working
  state across delegated tasks.
- Acknowledge this setup by replying with exactly: ok`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
