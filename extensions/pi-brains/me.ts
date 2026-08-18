import { copyToClipboard, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export interface AgentIdentityController {
  getSessionId(): string | null;
}

export interface AgentIdentityOptions {
  autoAcceptEnabled: boolean;
  pid?: number;
  copy?: (text: string) => Promise<void>;
}

/**
 * Format the compact identity contract consumed by GitSense Chat.
 *
 * Keep this deliberately small and stable: the session UUID identifies the
 * mailbox, the PID lets Chat verify the local process, and the final field
 * reports whether human-originated mailbox messages can be accepted
 * automatically.
 */
export function formatAgentIdentity(
  sessionId: string,
  pid: number,
  autoAcceptEnabled: boolean,
): string {
  return `${sessionId}::${pid}::${autoAcceptEnabled ? "on" : "off"}`;
}

/** Show and optionally copy the current Pi agent identity for GitSense Chat. */
export async function handleMeCommand(
  controller: AgentIdentityController,
  ctx: ExtensionCommandContext,
  options: AgentIdentityOptions,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/brains me is only available in the TUI", "error");
    return;
  }

  const sessionId = controller.getSessionId();
  if (!sessionId) {
    ctx.ui.notify("No active session. Start a conversation first.", "error");
    return;
  }

  const pid = options.pid ?? process.pid;
  const identity = formatAgentIdentity(sessionId, pid, options.autoAcceptEnabled);
  const action = await ctx.ui.select(
    `Pi Agent Info\n\n${identity}\n\nPaste this value into GitSense Chat to identify this agent.`,
    ["Copy agent info", "Close"],
  );
  if (action !== "Copy agent info") return;

  try {
    await (options.copy ?? copyToClipboard)(identity);
    ctx.ui.notify("Agent info copied to clipboard", "info");
  } catch (error) {
    ctx.ui.notify(`Failed to copy agent info: ${formatError(error)}`, "error");
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
