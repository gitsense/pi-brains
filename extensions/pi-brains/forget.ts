import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { ExtensionCommandContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { debugLog } from "./debug-log.ts";

/**
 * Result of analyzing whether entries after an anchor can be safely forgotten.
 */
export interface ForgetAnalysis {
  /** True when the entries after the anchor form a single linear chain rooted at the anchor. */
  clean: boolean;
  /** Human-readable reason when not clean. */
  reason?: string;
  /** The anchor entry (the point up to which the session is kept). Null when not found. */
  anchor: SessionEntry | null;
  /** Entries that would be removed (empty when not clean or when there is nothing to remove). */
  toRemove: SessionEntry[];
}

/**
 * Verify that every entry after `anchorId` (in file order) forms a single
 * linear chain rooted at the anchor:
 *
 *   first entry.parentId === anchorId
 *   each subsequent entry.parentId === previous entry.id
 *
 * This guarantees:
 *   - every removed entry is a descendant of the anchor
 *   - there are no branches after the anchor
 *   - after pruning, the file ends exactly at the anchor
 */
export function analyzeForget(entries: SessionEntry[], anchorId: string | null): ForgetAnalysis {
  if (!anchorId) {
    return {
      clean: false,
      reason: "No current position. Use /tree to jump to the last message you want to keep, then run /brains forget.",
      anchor: null,
      toRemove: [],
    };
  }

  const anchor = entries.find((e) => e.id === anchorId) ?? null;
  if (!anchor) {
    return {
      clean: false,
      reason: `Anchor entry ${anchorId} not found in the session.`,
      anchor: null,
      toRemove: [],
    };
  }

  const anchorIdx = entries.indexOf(anchor);
  const after = entries.slice(anchorIdx + 1);
  if (after.length === 0) {
    return { clean: true, anchor, toRemove: [] };
  }

  let expectedParent = anchor.id;
  for (const entry of after) {
    if (entry.parentId !== expectedParent) {
      return {
        clean: false,
        reason: `Refusing to forget: entry ${entry.id} (${describeEntryType(entry)}) has parent ${entry.parentId ?? "none"}, expected ${expectedParent}. There is a branch after the anchor.`,
        anchor,
        toRemove: [],
      };
    }
    expectedParent = entry.id;
  }

  return { clean: true, anchor, toRemove: after };
}

const PREVIEW_MAX = 30;

/**
 * Build a confirmation message: the anchor (kept) shown separately above a
 * clearly-labeled table of the entries that would be deleted:
 *   id | type | time | text preview
 */
export function buildForgetTable(anchor: SessionEntry, toRemove: SessionEntry[]): string {
  const idWidth = 12;
  const typeWidth = 18;
  const timeWidth = 9;
  const rows: string[] = [];
  const pad = (s: string, w: number): string => s.padEnd(w);

  rows.push("Anchor (kept):");
  rows.push(`  id:   ${anchor.id}`);
  rows.push(`  type: ${describeEntryType(anchor)}`);
  rows.push(`  time: ${formatTime(anchor.timestamp)}`);
  rows.push(`  text: ${previewText(anchor)}`);
  rows.push("");
  rows.push(`These ${toRemove.length} entr${toRemove.length === 1 ? "y" : "ies"} will be deleted:`);
  rows.push("");
  rows.push(`${pad("id", idWidth)}${pad("type", typeWidth)}${pad("time", timeWidth)}text`);
  rows.push("-".repeat(idWidth + typeWidth + timeWidth + PREVIEW_MAX + 1));
  for (const entry of toRemove) {
    rows.push(`${pad(entry.id, idWidth)}${pad(describeEntryType(entry), typeWidth)}${pad(formatTime(entry.timestamp), timeWidth)}${previewText(entry)}`);
  }
  return rows.join("\n");
}

/**
 * Single backup file next to the session file. Overwritten on each forget,
 * so repeated forgets in the same session do not accumulate backups.
 */
export function getBackupPath(sessionFile: string): string {
  return `${sessionFile}.bak`;
}

export interface ForgetFileResult {
  backupPath: string;
  removedCount: number;
}

/**
 * Backup the session file, then rewrite it without the removed entries.
 *
 * copy -> edit -> rename: the trimmed content is written to a temp file
 * first, then atomically renamed over the session file. A crash mid-write
 * cannot leave the session half-trimmed, and the backup is the restore point.
 */
export function performForgetFileOps(sessionFile: string, toRemove: SessionEntry[]): ForgetFileResult {
  const backupPath = getBackupPath(sessionFile);
  copyFileSync(sessionFile, backupPath);

  const removeIds = new Set(toRemove.map((e) => e.id));
  const lines = readFileSync(sessionFile, "utf8").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const kept = lines.filter((line) => {
    if (!line.trim()) return false;
    try {
      const entry = JSON.parse(line) as { id?: unknown };
      return !(typeof entry.id === "string" && removeIds.has(entry.id));
    } catch {
      return true; // keep malformed lines as-is
    }
  });

  const tmpPath = `${sessionFile}.tmp`;
  try {
    writeFileSync(tmpPath, `${kept.join("\n")}\n`);
    renameSync(tmpPath, sessionFile);
  } catch (error) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // best effort cleanup
    }
    throw error;
  }

  return { backupPath, removedCount: toRemove.length };
}

/**
 * Backup note shown in the confirmation dialog.
 */
export function buildBackupNote(sessionFile: string, backupExists: boolean): string {
  const path = getBackupPath(sessionFile);
  return backupExists
    ? `A backup already exists and will be overwritten:\n${path}`
    : `A backup will be created:\n${path}`;
}

/**
 * /brains forget: verify the session tail is a clean linear chain after the
 * current /tree position, confirm with the user, then:
 *   1. write a backup (overwritten on repeat forgets)
 *   2. rewrite the session file without the forgotten entries
 *   3. reload the session in place (switchSession) so pi matches the file
 */
export async function handleForgetCommand(ctx: ExtensionCommandContext): Promise<void> {
  const sessionFile = ctx.sessionManager.getSessionFile?.() ?? null;
  if (!sessionFile) {
    ctx.ui.notify("No active session file to prune.", "error");
    return;
  }

  const leafId = ctx.sessionManager.getLeafId?.() ?? null;
  const entries = ctx.sessionManager.getEntries();

  const analysis = analyzeForget(entries, leafId);
  if (!analysis.clean) {
    ctx.ui.notify(analysis.reason ?? "Refusing to forget.", "warning");
    return;
  }
  if (analysis.toRemove.length === 0 || !analysis.anchor) {
    ctx.ui.notify("Nothing to forget: no entries after the current position.", "info");
    return;
  }

  const table = buildForgetTable(analysis.anchor, analysis.toRemove);
  const backupNote = buildBackupNote(sessionFile, existsSync(getBackupPath(sessionFile)));
  const confirmed = await ctx.ui.confirm(
    "Forget session entries",
    `\n${table}\n\nThese entries will be removed from the session log.\n\n${backupNote}\n\nThis cannot be undone.`,
  );
  if (!confirmed) {
    ctx.ui.notify("Forget cancelled", "info");
    return;
  }

  // 1. Backup + 2. rewrite the session file
  let result: ForgetFileResult;
  try {
    result = performForgetFileOps(sessionFile, analysis.toRemove);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    debugLog("forget file ops failed", { sessionFile, error: message });
    ctx.ui.notify(`Forget failed: ${message}`, "error");
    return;
  }

  debugLog("forget file ops complete", {
    sessionFile,
    backupPath: result.backupPath,
    removedCount: result.removedCount,
    removed: analysis.toRemove.map((e) => e.id),
  });

  // 3. Reload the session so pi's in-memory state matches the trimmed file.
  // After the rewrite the file ends at the anchor, so the leaf is the anchor.
  // The captured command ctx is invalidated once the session is replaced, so
  // post-replacement notifications must use withSession's fresh ctx.
  try {
    const switched = await ctx.switchSession(sessionFile, {
      withSession: async (newCtx) => {
        newCtx.ui.notify(
          `Forget complete: removed ${result.removedCount} entries. Backup: ${result.backupPath}`,
          "info",
        );
      },
    });
    if (switched.cancelled) {
      // No replacement happened, so the captured ctx is still valid here.
      ctx.ui.notify(
        `Forget removed ${result.removedCount} entries. Session reload was cancelled — run /resume to load the trimmed session.`,
        "warning",
      );
    }
  } catch (error) {
    // The session may already be replaced, making the captured ctx stale.
    // Log and let pi surface the failure; the trimmed file and backup are intact.
    const message = error instanceof Error ? error.message : String(error);
    debugLog("forget reload failed", { sessionFile, error: message });
  }
}

function describeEntryType(entry: SessionEntry): string {
  if (entry.type === "message") return entry.message.role;
  if (entry.type === "custom") return `custom:${entry.customType}`;
  if (entry.type === "custom_message") return `custom_msg:${entry.customType}`;
  return entry.type;
}

function previewText(entry: SessionEntry): string {
  let text: string | undefined;

  switch (entry.type) {
    case "message": {
      const message = entry.message;
      if ("content" in message) {
        const content = message.content;
        if (typeof content === "string") {
          text = content;
        } else if (Array.isArray(content)) {
          text = content
            .filter((block) => block.type === "text")
            .map((block) => block.text ?? "")
            .join(" ");
        }
      } else if (message.role === "bashExecution") {
        text = `!${message.command} → ${message.output}`;
      }
      if (!text && message.role === "toolResult") {
        text = `(${message.toolName ?? "tool"})`;
      }
      break;
    }
    case "model_change":
      text = `${entry.provider}/${entry.modelId}`;
      break;
    case "thinking_level_change":
      text = entry.thinkingLevel;
      break;
    case "compaction":
      text = entry.summary;
      break;
    case "branch_summary":
      text = entry.summary;
      break;
    case "custom":
      text = entry.customType;
      break;
    case "custom_message": {
      const content = entry.content;
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .filter((block) => block.type === "text")
          .map((block) => block.text ?? "")
          .join(" ");
      }
      break;
    }
    case "label":
      text = entry.targetId;
      break;
    case "session_info":
      text = entry.name;
      break;
  }

  const trimmed = (text ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return "(no visible text)";
  if (trimmed.length <= PREVIEW_MAX) return trimmed;
  return `${trimmed.slice(0, PREVIEW_MAX - 1)}…`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
