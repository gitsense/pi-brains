import { randomUUID } from "node:crypto";
import type { AskGroup } from "./types.ts";

const GROUP_CHAT = "pi-sessions";

export interface ParsedAskGroupUrl {
  url: string;
  name: string;
  description: string;
  trackedSessionIds: string[];
}

export function parseAskGroupUrl(rawUrl: string): ParsedAskGroupUrl {
  const url = parseUrl(rawUrl);
  if (url.searchParams.get("chat") !== GROUP_CHAT) {
    throw new Error("The URL must open the GitSense Chat sessions view (chat=pi-sessions).");
  }

  const name = url.searchParams.get("track-name")?.trim() ?? "";
  if (!name) throw new Error("The group URL does not contain a group name.");

  const trackedSessionIds = unique(
    (url.searchParams.get("track") ?? "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean),
  );
  if (trackedSessionIds.length === 0) {
    throw new Error("The group URL does not contain any tracked sessions.");
  }

  return {
    url: url.toString(),
    name,
    description: url.searchParams.get("track-description")?.trim() ?? "",
    trackedSessionIds,
  };
}

export function createAskGroup(rawUrl: string, now = new Date().toISOString(), id: string = randomUUID()): AskGroup {
  const parsed = parseAskGroupUrl(rawUrl);
  return {
    id,
    url: parsed.url,
    createdAt: now,
    updatedAt: now,
  };
}

export function renameAskGroup(group: AskGroup, name: string, now = new Date().toISOString()): AskGroup {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("A group name is required.");

  const url = parseUrl(group.url);
  url.searchParams.set("track-name", trimmedName);
  return { ...group, url: url.toString(), updatedAt: now };
}

export function buildAskGroupUrl(group: AskGroup, currentSessionId: string): string {
  const sessionId = currentSessionId.trim();
  if (!sessionId) throw new Error("An active Pi session is required to open a knowledge group.");

  const parsed = parseAskGroupUrl(group.url);
  const url = new URL(parsed.url);
  url.searchParams.set("session", sessionId);
  url.searchParams.set("track", unique([...parsed.trackedSessionIds, sessionId]).join(","));
  return url.toString();
}

export function getAskGroupDetails(group: AskGroup): ParsedAskGroupUrl {
  return parseAskGroupUrl(group.url);
}

function parseUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("Enter the complete GitSense Chat group URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The group URL must use http or https.");
  }
  return url;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
