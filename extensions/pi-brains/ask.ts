import { copyToClipboard, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { buildChatUrl, getChatAppStatus, openExternalUrl, type ChatAppController } from "./chat-app.ts";
import { saveConfig } from "./config.ts";
import { buildAskGroupUrl, createAskGroup, getAskGroupDetails, parseAskGroupUrl, renameAskGroup } from "./ask-groups.ts";
import type { AskGroup, PiBrainsConfig } from "./types.ts";
import { showOutputPanel } from "./output-panel.ts";

export interface AskController extends ChatAppController {
  getSessionId(): string | null;
}

type PersistConfig = (config: PiBrainsConfig) => Promise<void>;

export async function handleAskCommand(
  controller: AskController,
  config: PiBrainsConfig,
  ctx: ExtensionCommandContext,
  value = "",
  persist: PersistConfig = (nextConfig) => saveConfig(nextConfig),
): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) {
    await openAskGroupPicker(controller, config, ctx);
    return;
  }

  const [command, ...rest] = trimmed.split(/\s+/);
  const remainder = rest.join(" ").trim();
  switch (command.toLowerCase()) {
    case "help":
      await showAskHelp(ctx);
      return;
    case "list":
    case "groups":
      await showAskGroupList(config, ctx);
      return;
    case "register":
      await registerAskGroup(config, ctx, remainder, persist);
      return;
    case "rename":
      await renameSavedAskGroup(config, ctx, remainder, persist);
      return;
    case "delete":
    case "remove":
      await deleteSavedAskGroup(config, ctx, remainder, persist);
      return;
    default:
      await openNamedAskGroup(controller, config, ctx, trimmed);
  }
}

async function openAskGroupPicker(controller: AskController, config: PiBrainsConfig, ctx: ExtensionCommandContext): Promise<void> {
  if (config.askGroups.length === 0) {
    await showAskSetup(controller, ctx);
    return;
  }

  const groups = validGroups(config);
  if (groups.length === 0) {
    ctx.ui.notify("No valid knowledge groups are saved. Register a new group URL with /brains ask register <url>.", "warning");
    return;
  }

  const options = groups.map(formatGroupOption);
  options.push("List saved groups", "Close");
  const selected = await ctx.ui.select("Choose a knowledge group", options);
  if (!selected || selected === "Close") return;
  if (selected === "List saved groups") {
    await showAskGroupList(config, ctx);
    return;
  }

  const index = options.indexOf(selected);
  const group = groups[index];
  if (group) await openAskGroup(controller, group, ctx);
}

async function openNamedAskGroup(controller: AskController, config: PiBrainsConfig, ctx: ExtensionCommandContext, name: string): Promise<void> {
  const groups = validGroups(config);
  const group = groups.find(item => getAskGroupDetails(item).name.toLowerCase() === name.toLowerCase());
  if (!group) {
    ctx.ui.notify(`No saved knowledge group named "${name}". Run /brains ask list to see the available groups.`, "warning");
    return;
  }
  await openAskGroup(controller, group, ctx);
}

async function openAskGroup(controller: AskController, group: AskGroup, ctx: ExtensionCommandContext): Promise<void> {
  const sessionId = controller.getSessionId();
  if (!sessionId) {
    ctx.ui.notify("Start a Pi conversation before opening a knowledge group.", "error");
    return;
  }

  let url: string;
  try {
    url = buildAskGroupUrl(group, sessionId);
  } catch (error) {
    ctx.ui.notify(formatError(error), "error");
    return;
  }

  try {
    await openExternalUrl(url, process.platform);
    ctx.ui.notify(`Opening ${getAskGroupDetails(group).name} in GitSense Chat`, "info");
  } catch (error) {
    ctx.ui.notify(`Failed to open GitSense Chat: ${formatError(error)}`, "error");
  }
}

async function registerAskGroup(
  config: PiBrainsConfig,
  ctx: ExtensionCommandContext,
  rawUrl: string,
  persist: PersistConfig,
): Promise<void> {
  if (!rawUrl) {
    await showAskHelp(ctx);
    return;
  }

  let parsed;
  try {
    parsed = parseAskGroupUrl(rawUrl);
  } catch (error) {
    ctx.ui.notify(formatError(error), "error");
    return;
  }

  const existing = validGroups(config).find(group => getAskGroupDetails(group).name.toLowerCase() === parsed.name.toLowerCase());
  if (existing) {
    const replace = await ctx.ui.confirm(
      `Replace saved group "${parsed.name}"?`,
      "This updates the saved URL and tracked experts. Existing Pi sessions are not changed.",
    );
    if (!replace) return;
    const index = config.askGroups.findIndex(group => group.id === existing.id);
    if (index >= 0) {
      config.askGroups[index] = {
        ...existing,
        url: parsed.url,
        updatedAt: new Date().toISOString(),
      };
    }
  } else {
    config.askGroups.push(createAskGroup(parsed.url));
  }

  await persist(config);
  ctx.ui.notify(`Saved knowledge group "${parsed.name}".`, "info");
}

async function renameSavedAskGroup(
  config: PiBrainsConfig,
  ctx: ExtensionCommandContext,
  requestedName: string,
  persist: PersistConfig,
): Promise<void> {
  const group = await chooseSavedGroup(config, ctx, requestedName, "Choose a group to rename");
  if (!group) return;

  const currentName = getAskGroupDetails(group).name;
  const newName = await ctx.ui.input(`Rename "${currentName}"`, currentName);
  if (newName === undefined || !newName.trim() || newName.trim() === currentName) return;

  const duplicate = validGroups(config).some(item =>
    item.id !== group.id && getAskGroupDetails(item).name.toLowerCase() === newName.trim().toLowerCase(),
  );
  if (duplicate) {
    ctx.ui.notify(`A saved knowledge group named "${newName.trim()}" already exists.`, "warning");
    return;
  }

  const index = config.askGroups.findIndex(item => item.id === group.id);
  if (index < 0) return;
  config.askGroups[index] = renameAskGroup(group, newName);
  await persist(config);
  ctx.ui.notify(`Renamed knowledge group to "${newName.trim()}".`, "info");
}

async function deleteSavedAskGroup(
  config: PiBrainsConfig,
  ctx: ExtensionCommandContext,
  requestedName: string,
  persist: PersistConfig,
): Promise<void> {
  const group = await chooseSavedGroup(config, ctx, requestedName, "Choose a group to remove");
  if (!group) return;

  const name = getAskGroupDetails(group).name;
  const confirmed = await ctx.ui.confirm(
    `Remove saved group "${name}"?`,
    "This removes the saved group URL. It does not delete any Pi sessions or agents.",
  );
  if (!confirmed) return;

  config.askGroups = config.askGroups.filter(item => item.id !== group.id);
  await persist(config);
  ctx.ui.notify(`Removed saved knowledge group "${name}".`, "info");
}

async function chooseSavedGroup(
  config: PiBrainsConfig,
  ctx: ExtensionCommandContext,
  requestedName: string,
  title: string,
): Promise<AskGroup | null> {
  const groups = validGroups(config);
  if (groups.length === 0) {
    ctx.ui.notify("No saved knowledge groups. Register one with /brains ask register <url>.", "warning");
    return null;
  }
  if (requestedName) {
    const exact = groups.find(group => getAskGroupDetails(group).name.toLowerCase() === requestedName.toLowerCase());
    if (!exact) {
      ctx.ui.notify(`No saved knowledge group named "${requestedName}". Run /brains ask list to see the available groups.`, "warning");
    }
    return exact ?? null;
  }

  const options = groups.map(formatGroupOption);
  options.push("Cancel");
  const selected = await ctx.ui.select(title, options);
  if (!selected || selected === "Cancel") return null;
  return groups[options.indexOf(selected)] ?? null;
}

async function showAskGroupList(config: PiBrainsConfig, ctx: ExtensionCommandContext): Promise<void> {
  const groups = validGroups(config);
  if (groups.length === 0) {
    await showOutputPanel(ctx, "Saved Knowledge Groups", "No groups are saved yet.\n\nOpen /brains ask to learn how to register one.");
    return;
  }

  const lines = [`Saved knowledge groups (${groups.length})`, ""];
  for (const group of groups) {
    const details = getAskGroupDetails(group);
    lines.push(
      details.name,
      details.description ? `  ${details.description}` : "  No description",
      `  Experts: ${details.trackedSessionIds.length}`,
      `  Open: /brains ask ${details.name}`,
      "",
    );
  }
  await showOutputPanel(ctx, "Saved Knowledge Groups", lines.join("\n"));
}

async function showAskSetup(controller: AskController, ctx: ExtensionCommandContext): Promise<void> {
  const status = await getChatAppStatus(controller);
  const sessionsUrl = status.baseUrl ? buildChatUrl(status.baseUrl, "sessions") : "";
  const lines = [
    "No knowledge groups are saved yet.",
    "",
    "Create a group in GitSense Chat by tracking the experts you want to ask.",
    "Then copy the group URL and register it with:",
    "  /brains ask register <url>",
  ];
  if (sessionsUrl) lines.push("", `Sessions URL: ${sessionsUrl}`);
  if (status.state === "stopped") lines.push("", "Start GitSense Chat with: gsc app native start");
  if (status.state === "not-installed") lines.push("", "Install GitSense Chat with: gsc app native install");

  const options: Array<{ action: "open" | "copy" | "start" | "install" | "close"; label: string }> = [];
  if (sessionsUrl) {
    options.push(
      { action: "open", label: `Open GitSense Chat sessions: ${sessionsUrl}` },
      { action: "copy", label: `Copy GitSense Chat sessions URL: ${sessionsUrl}` },
    );
  }
  if (status.state === "stopped") options.push({ action: "start", label: "Copy start command: gsc app native start" });
  if (status.state === "not-installed") options.push({ action: "install", label: "Copy install command: gsc app native install" });
  options.push({ action: "close", label: "Close" });

  const selected = await ctx.ui.select(lines.join("\n"), options.map(option => option.label));
  const action = options.find(option => option.label === selected)?.action;
  if (action === "open" && sessionsUrl) await openUrl(sessionsUrl, ctx, "GitSense Chat sessions");
  if (action === "copy" && sessionsUrl) await copyUrl(sessionsUrl, ctx, "Sessions URL");
  if (action === "start") await copyCommand("gsc app native start", "Start command", ctx);
  if (action === "install") await copyCommand("gsc app native install", "Install command", ctx);
}

async function showAskHelp(ctx: ExtensionCommandContext): Promise<void> {
  await showOutputPanel(
    ctx,
    "/brains ask",
    `Open and manage saved knowledge groups.

  /brains ask                         Choose a group and open it in GitSense Chat
  /brains ask <group-name>             Open a saved group directly
  /brains ask register <url>           Save a group URL
  /brains ask list                     List saved groups (groups is an alias)
  /brains ask rename                   Rename a saved group
  /brains ask delete                   Remove a saved group
  /brains ask help                     Show this help

When a group is opened, the current Pi session is added temporarily so the
final message can be sent back through /brains inbox.`,
  );
}

function validGroups(config: PiBrainsConfig): AskGroup[] {
  return config.askGroups.filter(group => {
    try {
      getAskGroupDetails(group);
      return true;
    } catch {
      return false;
    }
  });
}

function formatGroupOption(group: AskGroup): string {
  const details = getAskGroupDetails(group);
  const description = details.description ? ` — ${details.description}` : "";
  return `${details.name} (${details.trackedSessionIds.length} experts)${description}`;
}

async function openUrl(url: string, ctx: ExtensionCommandContext, label: string): Promise<void> {
  try {
    await openExternalUrl(url, process.platform);
    ctx.ui.notify(`Opening ${label}`, "info");
  } catch (error) {
    ctx.ui.notify(`Failed to open browser: ${formatError(error)}`, "error");
  }
}

async function copyUrl(url: string, ctx: ExtensionCommandContext, label: string): Promise<void> {
  try {
    await copyToClipboard(url);
    ctx.ui.notify(`${label} copied to clipboard`, "info");
  } catch (error) {
    ctx.ui.notify(`Failed to copy URL: ${formatError(error)}`, "error");
  }
}

async function copyCommand(command: string, label: string, ctx: ExtensionCommandContext): Promise<void> {
  try {
    await copyToClipboard(command);
    ctx.ui.notify(`${label} copied to clipboard`, "info");
  } catch (error) {
    ctx.ui.notify(`Failed to copy command: ${formatError(error)}`, "error");
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
