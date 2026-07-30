import { buildChatUrl, type ChatAppStatus } from "./chat-app.ts";

export type SessionsAction = "open-chat" | "copy-chat-url" | "copy-start" | "copy-install" | "close";

export interface SessionsOption {
  action: SessionsAction;
  label: string;
}

export interface SessionsDialog {
  message: string;
  options: SessionsOption[];
  chatUrl: string;
}

export function buildSessionsDialog(chatAppStatus: ChatAppStatus): SessionsDialog {
  const chatUrl = chatAppStatus.baseUrl
    ? buildChatUrl(chatAppStatus.baseUrl, "sessions")
    : "";
  const lines = [
    "Review all Pi sessions in GitSense Chat.",
    "",
    "GitSense Chat:",
  ];

  if (chatAppStatus.state === "running") {
    lines.push(`  Running at ${chatAppStatus.baseUrl}`);
  } else if (chatAppStatus.state === "stopped") {
    lines.push("  Not running.", "  Start it with: gsc app native start");
  } else if (chatAppStatus.state === "not-installed") {
    lines.push("  Not installed.", "  Install it with: gsc app native install");
  } else {
    lines.push("  Status unavailable.");
  }

  if (chatUrl) {
    lines.push("", `Sessions URL: ${chatUrl}`);
  }

  const options: SessionsOption[] = [];
  if (chatUrl) {
    options.push(
      { action: "open-chat", label: `Open GitSense Chat sessions: ${chatUrl}` },
      { action: "copy-chat-url", label: `Copy GitSense Chat sessions URL: ${chatUrl}` },
    );
  }
  if (chatAppStatus.state === "stopped") {
    options.push({ action: "copy-start", label: "Copy start command: gsc app native start" });
  } else if (!chatUrl && chatAppStatus.state === "not-installed") {
    options.push({ action: "copy-install", label: "Copy install command: gsc app native install" });
  }
  options.push({ action: "close", label: "Close" });

  return { message: lines.join("\n"), options, chatUrl };
}
