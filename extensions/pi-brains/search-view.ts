import { buildChatUrl, type ChatAppStatus } from "./chat-app.ts";

export type SearchAction = "open-chat" | "copy-chat-url" | "copy-start" | "copy-install" | "close";

export interface SearchOption {
  action: SearchAction;
  label: string;
}

export interface SearchDialog {
  message: string;
  options: SearchOption[];
  chatUrl: string;
}

export function buildSearchDialog(chatAppStatus: ChatAppStatus): SearchDialog {
  const chatUrl = chatAppStatus.baseUrl
    ? buildSearchUrl(chatAppStatus.baseUrl)
    : "";
  const lines = [
    "Search across Pi sessions in GitSense Chat.",
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
    lines.push("", `Search URL: ${chatUrl}`);
  }

  const options: SearchOption[] = [];
  if (chatUrl) {
    options.push(
      { action: "open-chat", label: `Open GitSense Chat search: ${chatUrl}` },
      { action: "copy-chat-url", label: `Copy GitSense Chat search URL: ${chatUrl}` },
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

function buildSearchUrl(baseUrl: string): string {
  const url = new URL(buildChatUrl(baseUrl, "sessions"));
  url.searchParams.set("tab", "search");
  return url.toString();
}
