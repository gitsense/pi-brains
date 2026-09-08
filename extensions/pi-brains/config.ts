import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { AskGroup, PiBrainsConfig } from "./types.ts";

export const GSC_MISSING_NOTICE_ID = "gsc-missing-v1";

export const DEFAULT_CONFIG: PiBrainsConfig = {
  visible: false,
  width: 38,
  minTerminalWidth: 100,
  font: "3x5",
  glyph: "block",
  brightness: "dim",
  showModel: true,
  showRepositories: true,
  dismissedNotices: [],
  rulesEnabled: true,
  debug: false,
  guideEnabled: false,
  snapshotInsightSessionIds: [],
  inboxAutoAccept: false,
  waitGroupCursors: {},
  askGroups: [],
};

export function getConfigPath(): string {
  return process.env.PI_BRAINS_CONFIG ?? join(homedir(), ".pi", "agent", "pi-brains.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAskGroups(value: unknown): AskGroup[] {
  if (!Array.isArray(value)) return [...DEFAULT_CONFIG.askGroups];
  return value.flatMap((item): AskGroup[] => {
    if (!isRecord(item)) return [];
    if (
      typeof item.id !== "string" ||
      typeof item.url !== "string" ||
      typeof item.createdAt !== "string" ||
      typeof item.updatedAt !== "string"
    ) {
      return [];
    }
    return [{
      id: item.id,
      url: item.url,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }];
  });
}

function parseWaitGroupCursors(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number" && Number.isInteger(item) && item >= 0) {
      result[key] = item;
    }
  }
  return result;
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim() !== ""))];
}

export function parseConfig(value: unknown): PiBrainsConfig {
  if (!isRecord(value)) return { ...DEFAULT_CONFIG };

  return {
    visible: typeof value.visible === "boolean" ? value.visible : DEFAULT_CONFIG.visible,
    width:
      typeof value.width === "number" && Number.isInteger(value.width) && value.width >= 24 && value.width <= 80
        ? value.width
        : DEFAULT_CONFIG.width,
    minTerminalWidth:
      typeof value.minTerminalWidth === "number" && Number.isInteger(value.minTerminalWidth) && value.minTerminalWidth >= 60
        ? value.minTerminalWidth
        : DEFAULT_CONFIG.minTerminalWidth,
    font: value.font === "5x7" ? "5x7" : "3x5",
    glyph: value.glyph === "ascii" ? "ascii" : "block",
    brightness: value.brightness === "normal" ? "normal" : "dim",
    showModel: typeof value.showModel === "boolean" ? value.showModel : DEFAULT_CONFIG.showModel,
    showRepositories:
      typeof value.showRepositories === "boolean" ? value.showRepositories : DEFAULT_CONFIG.showRepositories,
    dismissedNotices: Array.isArray(value.dismissedNotices)
      ? value.dismissedNotices.filter((item): item is string => typeof item === "string")
      : [],
    rulesEnabled: typeof value.rulesEnabled === "boolean" ? value.rulesEnabled : DEFAULT_CONFIG.rulesEnabled,
    debug: typeof value.debug === "boolean" ? value.debug : DEFAULT_CONFIG.debug,
    guideEnabled: typeof value.guideEnabled === "boolean" ? value.guideEnabled : DEFAULT_CONFIG.guideEnabled,
    snapshotInsightSessionIds: parseStringList(value.snapshotInsightSessionIds),
    inboxAutoAccept: typeof value.inboxAutoAccept === "boolean" ? value.inboxAutoAccept : DEFAULT_CONFIG.inboxAutoAccept,
    waitGroupCursors: parseWaitGroupCursors(value.waitGroupCursors),
    askGroups: parseAskGroups(value.askGroups),
  };
}

export async function loadConfig(path = getConfigPath()): Promise<PiBrainsConfig> {
  try {
    return parseConfig(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: PiBrainsConfig, path = getConfigPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
