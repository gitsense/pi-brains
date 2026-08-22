/**
 * Pi Buddy startup activation
 *
 * Consumes the one-shot GSC_PI_BUDDY_BOOTSTRAP handoff during session_start,
 * materializes exactly one immutable Pi custom entry, requests the Buddy
 * charter, and records an atomic activation acknowledgement.
 */

import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveGscHome } from "./inbox.ts";
import {
  PI_BUDDY_ACTIVATION_FILE_NAME,
  PI_BUDDY_BOOTSTRAP_ENV,
  PI_BUDDY_BOOTSTRAP_FILE_NAME,
  PI_BUDDY_CHARTER_MARKER,
  PI_BUDDY_CUSTOM_TYPE,
  buildPiBuddyCharter,
  bootstrapSha256,
  parsePiBuddyActivationAcknowledgement,
  parsePiBuddyBootstrap,
  parsePiBuddyMetadata,
  piBuddyMetadataFromBootstrap,
  piBuddyDisplayName,
  type PiBuddyActivationAcknowledgement,
  type PiBuddyBootstrap,
  type PiBuddyMetadata,
} from "./buddy-contract.ts";

interface BuddyEntryLike {
  type?: unknown;
  id?: unknown;
  customType?: unknown;
  data?: unknown;
  message?: unknown;
}

export interface PiBuddyActivationResult {
  activated: boolean;
  sessionId: string;
  bootstrapPath: string;
  activationPath: string;
  customEntryId: string;
  charterRequested: true;
}

interface LoadedBootstrap {
  bootstrap: PiBuddyBootstrap;
  raw: Buffer;
  path: string;
  activationPath: string;
}

/**
 * Activate a Buddy from the reserved startup environment handoff.
 * Returns null when the environment variable is absent, which is the normal
 * path for every standard Pi session.
 */
export function activatePiBuddyAtStartup(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): PiBuddyActivationResult | null {
  const rawBootstrapPath = process.env[PI_BUDDY_BOOTSTRAP_ENV];
  if (!rawBootstrapPath || rawBootstrapPath.trim() === "") return null;

  const sessionId = ctx.sessionManager.getSessionId();
  if (!sessionId) throw new Error("Pi Buddy bootstrap cannot activate without an active Pi session ID");

  const loaded = loadBootstrap(rawBootstrapPath, sessionId);
  const expectedMetadata = piBuddyMetadataFromBootstrap(loaded.bootstrap);
  const initialEntries = ctx.sessionManager.getEntries() as readonly BuddyEntryLike[];
  const existingEntries = findBuddyEntries(initialEntries);

  if (existingEntries.length > 1) {
    throw new Error(`Pi session ${sessionId} contains more than one ${PI_BUDDY_CUSTOM_TYPE} entry; activation aborted`);
  }

  let customEntry: BuddyEntryLike;
  if (existingEntries.length === 1) {
    customEntry = existingEntries[0]!;
    const existingMetadata = parsePiBuddyMetadata(customEntry.data, sessionId);
    if (!metadataEqual(existingMetadata, expectedMetadata)) {
      throw new Error(`Pi Buddy custom entry for ${sessionId} conflicts with the retained bootstrap`);
    }
    if (typeof customEntry.id !== "string" || customEntry.id.trim() === "") {
      throw new Error(`Pi Buddy custom entry for ${sessionId} has no stable entry id`);
    }
  } else {
    if (hasUnexpectedConversation(initialEntries)) {
      throw new Error(`Pi Buddy bootstrap requires a fresh Pi session; session ${sessionId} already has conversation activity`);
    }
    pi.appendEntry(PI_BUDDY_CUSTOM_TYPE, expectedMetadata);
    const appendedEntries = findBuddyEntries(ctx.sessionManager.getEntries() as readonly BuddyEntryLike[]);
    if (appendedEntries.length !== 1) {
      throw new Error(`Pi Buddy custom entry was not persisted exactly once for session ${sessionId}`);
    }
    customEntry = appendedEntries[0]!;
    const appendedMetadata = parsePiBuddyMetadata(customEntry.data, sessionId);
    if (!metadataEqual(appendedMetadata, expectedMetadata)) {
      throw new Error(`Pi Buddy custom entry for ${sessionId} does not match the retained bootstrap`);
    }
    if (typeof customEntry.id !== "string" || customEntry.id.trim() === "") {
      throw new Error(`Pi Buddy custom entry for ${sessionId} has no stable entry id`);
    }
  }

  if (!ctx.sessionManager.getSessionName()) {
    pi.setSessionName(piBuddyDisplayName(expectedMetadata));
  }

  let charterRequested = hasBuddyCharter(initialEntries, expectedMetadata);
  if (!charterRequested) {
    if (existingEntries.length === 1 && hasUnexpectedConversation(initialEntries)) {
      throw new Error(`Pi Buddy charter is missing from active session ${sessionId}; refusing to inject it after conversation activity`);
    }
    try {
      pi.sendUserMessage(buildPiBuddyCharter(expectedMetadata));
      charterRequested = true;
    } catch (error) {
      throw new Error(`Pi Buddy charter request failed for ${sessionId}: ${formatError(error)}`);
    }
  }

  const customEntryId = customEntry.id as string;
  const existingAcknowledgement = readValidAcknowledgement(loaded);
  if (
    existingAcknowledgement &&
    existingAcknowledgement.custom_entry_id === customEntryId &&
    existingAcknowledgement.charter_requested === charterRequested
  ) {
    return {
      activated: true,
      sessionId,
      bootstrapPath: loaded.path,
      activationPath: loaded.activationPath,
      customEntryId,
      charterRequested: true,
    };
  }

  const acknowledgement: PiBuddyActivationAcknowledgement = {
    schema_version: 1,
    bootstrap_id: loaded.bootstrap.bootstrap_id,
    pi_session_id: loaded.bootstrap.pi_session_id,
    bootstrap_sha256: bootstrapSha256(loaded.raw),
    custom_entry_id: customEntryId,
    charter_requested: true,
    activated_at: new Date().toISOString(),
  };
  writeActivationAcknowledgement(loaded.activationPath, acknowledgement);

  return {
    activated: true,
    sessionId,
    bootstrapPath: loaded.path,
    activationPath: loaded.activationPath,
    customEntryId,
    charterRequested: true,
  };
}

function loadBootstrap(rawPath: string, sessionId: string): LoadedBootstrap {
  if (!isAbsolute(rawPath)) {
    throw new Error(`${PI_BUDDY_BOOTSTRAP_ENV} must be an absolute path`);
  }
  const { gscHome } = resolveGscHome();
  const expectedPath = resolve(gscHome, "data", "pi", "sessions", sessionId, PI_BUDDY_BOOTSTRAP_FILE_NAME);
  const candidatePath = resolve(rawPath);
  if (candidatePath !== expectedPath) {
    throw new Error(`${PI_BUDDY_BOOTSTRAP_ENV} must point to ${expectedPath}`);
  }
  const stat = lstatSync(candidatePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Pi Buddy bootstrap must not be a symbolic link: ${candidatePath}`);
  }
  const raw = readFileSync(candidatePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    throw new Error(`Pi Buddy bootstrap is not valid JSON: ${formatError(error)}`);
  }
  const bootstrap = parsePiBuddyBootstrap(parsed, sessionId);
  return {
    bootstrap,
    raw,
    path: candidatePath,
    activationPath: join(dirname(candidatePath), PI_BUDDY_ACTIVATION_FILE_NAME),
  };
}

function findBuddyEntries(entries: readonly BuddyEntryLike[]): BuddyEntryLike[] {
  return entries.filter((entry) => entry.type === "custom" && entry.customType === PI_BUDDY_CUSTOM_TYPE);
}

function metadataEqual(left: PiBuddyMetadata, right: PiBuddyMetadata): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.piSessionId === right.piSessionId
    && left.partnerAgent === right.partnerAgent
    && left.partnerNativeSessionId === right.partnerNativeSessionId
    && left.partnerTransport === right.partnerTransport
    && left.createdAt === right.createdAt;
}

function hasUnexpectedConversation(entries: readonly BuddyEntryLike[]): boolean {
  return entries.some((entry) => {
    if (entry.type !== "message") return false;
    const role = (entry.message as { role?: unknown } | undefined)?.role;
    return role === "user" || role === "assistant" || role === "toolResult";
  });
}

function hasBuddyCharter(entries: readonly BuddyEntryLike[], binding: PiBuddyMetadata): boolean {
  return entries.some((entry) => {
    if (entry.type !== "message") return false;
    const message = entry.message as { role?: unknown; content?: unknown } | undefined;
    if (message?.role !== "user") return false;
    const content = textContent(message.content);
    return content.includes(PI_BUDDY_CHARTER_MARKER) && content.includes(binding.piSessionId);
  });
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    if (typeof part !== "object" || part === null) return [];
    const text = (part as { type?: unknown; text?: unknown });
    return text.type === "text" && typeof text.text === "string" ? [text.text] : [];
  }).join("\n");
}

function readValidAcknowledgement(loaded: LoadedBootstrap): PiBuddyActivationAcknowledgement | null {
  if (!existsSync(loaded.activationPath)) return null;
  try {
    const stat = lstatSync(loaded.activationPath);
    if (stat.isSymbolicLink()) return null;
    const raw = readFileSync(loaded.activationPath);
    return parsePiBuddyActivationAcknowledgement(JSON.parse(raw.toString("utf8")), loaded.bootstrap, loaded.raw);
  } catch {
    return null;
  }
}

function writeActivationAcknowledgement(path: string, acknowledgement: PiBuddyActivationAcknowledgement): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const temporaryPath = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  const raw = JSON.stringify(acknowledgement);
  let fd: number | undefined;
  try {
    fd = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(fd, raw, { encoding: "utf8" });
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
