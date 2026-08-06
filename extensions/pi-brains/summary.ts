/**
 * Session Summary Handler
 *
 * Handles the /brains summary command.
 *
 * The command injects a user message instructing the agent to review the
 * session and produce a structured markdown summary as its final message.
 * The summary becomes the last message of the session, which GitSense Chat
 * surfaces by default when cycling through sessions. It therefore acts as
 * the session's cover message: it must be self-contained and scannable
 * enough to identify the session at a glance, even when the session name
 * is weak or forgotten.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { debugLog } from "./debug-log.ts";

/**
 * Handle the /brains summary command.
 * Sends the summary instructions as a user message so the agent's reply
 * becomes the final message of the session.
 */
export async function handleSummaryCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext
): Promise<void> {
  debugLog("Starting summary command");

  const sessionName = pi.getSessionName() ?? null;
  const instructions = buildSummaryInstructions(sessionName);

  // Hide the working spinner from the previous turn before sending
  ctx.ui.setWorkingVisible(false);

  pi.sendUserMessage(instructions);
  ctx.ui.notify("Generating session summary...", "info");
  debugLog("Summary instructions sent", { sessionName });
}

/**
 * Build the summary instructions for the agent.
 *
 * The agent's reply becomes the last message of the session, so the prompt
 * enforces a fixed markdown shape (title + What was discussed / Topics /
 * Key decisions) that is easy to scan when cycling sessions in GitSense Chat.
 */
export function buildSummaryInstructions(sessionName: string | null): string {
  const nameLine = sessionName
    ? `The session name is "${sessionName}". Use it as the base for the title and extend it with the most distinctive specifics of the session.`
    : `No session name is set. Derive the title entirely from the session content.`;

  return `Generate a session summary for this Pi session.

This summary will be the last message of the session and is shown by default when cycling through sessions in GitSense Chat, so it must be self-contained and scannable enough to identify the session at a glance.

${nameLine}

Review the full session conversation first, then output ONLY the summary in this exact markdown format (no preamble, no postscript):

## <Title>

### What was discussed
- <bullet>
- <bullet>

### Topics
<topic> · <topic> · <topic>

### Key decisions
- <bullet>
- <bullet>

Formatting rules:
- Title: one short descriptive line that captures what this session was about. Name the dominant feature, component, or bug, plus the main supporting threads.
- What was discussed: 4-8 bullets summarizing what was actually worked on. Be specific: name features, components, files, or bugs. Keep each bullet to about two lines, wrapped at ~80 characters.
- Topics: 4-12 lowercase kebab-case tags ordered by prominence, joined with " · " (space, middle dot, space). Use only tags that accurately describe the session.
- Key decisions: 2-6 bullets capturing decisions made during the session. Be concrete; include the reasoning only when it matters.

Content rules:
- Only include what actually happened in this session. Do not invent work, decisions, or topics.
- If a decision or topic is uncertain, omit it.
- Do not write any files, create notes, run gsc commands, or use other tools. Reply with the summary text only.`;
}
