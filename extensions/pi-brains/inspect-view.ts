import { buildChatUrl, type ChatAppStatus } from "./chat-app.ts";

export type InspectAction =
  | "copy-terminal"
  | "open-chat"
  | "copy-chat-url"
  | "copy-start"
  | "copy-install"
  | "close";

export interface InspectOption {
  action: InspectAction;
  label: string;
}

export interface InspectDialog {
  message: string;
  options: InspectOption[];
  chatUrl: string;
}

export interface InspectDialogInput {
  sessionId: string | null;
  gscCommand: string;
  shortcuts: string[];
  chatAppStatus: ChatAppStatus;
}

export function buildInspectDialog(input: InspectDialogInput): InspectDialog {
  const chatUrl = input.sessionId && input.chatAppStatus.baseUrl
    ? buildChatUrl(input.chatAppStatus.baseUrl, input.sessionId)
    : "";
  const lines = [
    "Inspect this session in another terminal or GitSense Chat.",
    "",
    "Terminal:",
    `  ${input.gscCommand}`,
  ];

  if (!input.sessionId) {
    lines.push("  No active session yet; this command waits for one.");
  }
  if (input.shortcuts.length > 0) {
    lines.push("");
    lines.push("Split shortcuts:");
    input.shortcuts.forEach(shortcut => lines.push(`  ${shortcut}`));
  }

  lines.push("");
  lines.push("GitSense Chat:");
  lines.push(...formatChatAppStatus(input.chatAppStatus, input.sessionId, chatUrl));

  const options: InspectOption[] = [{
    action: "copy-terminal",
    label: `Copy terminal command: ${input.gscCommand}`,
  }];

  if (chatUrl) {
    options.push(
      { action: "open-chat", label: `Open GitSense Chat: ${chatUrl}` },
      { action: "copy-chat-url", label: `Copy GitSense Chat URL: ${chatUrl}` },
    );
  } else if (input.chatAppStatus.state === "stopped") {
    options.push({
      action: "copy-start",
      label: "Copy start command: gsc app native start",
    });
  } else if (input.chatAppStatus.state === "not-installed") {
    options.push({
      action: "copy-install",
      label: "Copy install command: gsc app native install",
    });
  }

  options.push({ action: "close", label: "Close" });
  return { message: lines.join("\n"), options, chatUrl };
}

function formatChatAppStatus(
  status: ChatAppStatus,
  sessionId: string | null,
  chatUrl: string,
): string[] {
  if (status.state === "running") {
    const lines = [`  Running at ${status.baseUrl}`];
    if (sessionId) {
      lines.push(`  Session URL: ${chatUrl}`);
    } else {
      lines.push("  Browser inspection becomes available once Pi has an active session.");
    }
    return lines;
  }
  if (status.state === "stopped") {
    return [
      "  Not running.",
      "  Start it with: gsc app native start",
    ];
  }
  if (status.state === "not-installed") {
    return [
      "  Not installed.",
      "  Install it with: gsc app native install",
    ];
  }
  return [
    "  Status unavailable.",
    "  The terminal inspection command is still available.",
  ];
}
