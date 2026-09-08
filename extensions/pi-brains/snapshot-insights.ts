import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export interface SnapshotStageSummary {
  snapshot_id: string;
  sequence: number;
  created_at: string;
  leaf_id: string;
  file_count: number;
  bytes_captured: number;
  incomplete: boolean;
  git_commit?: string;
}

export interface PendingSnapshotToolCall {
  toolName: string;
  path?: string;
}

export interface SnapshotInsightActivity {
  recognizedFiles: string[];
  directMutationFiles: string[];
  shellActivity: boolean;
  boundaryOnActiveBranch: boolean;
}

export interface SnapshotInsightFacts extends SnapshotInsightActivity {
  enabled: boolean;
  snapshotCount: number | null;
  latestSnapshot: SnapshotStageSummary | null;
  snapshotLoadError: boolean;
}

interface ToolCallRecord {
  toolName: string;
  path?: string;
  entryIndex: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedPath(path: string, cwd: string): string {
  const expanded = path === "~" || path.startsWith("~/") ? homedir() + path.slice(1) : path;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

function addRecognizedPath(paths: Set<string>, path: unknown, cwd: string): void {
  if (typeof path === "string" && path.trim()) paths.add(normalizedPath(path, cwd));
}

/**
 * Derive deterministic snapshot-review facts from the active Pi branch.
 * Direct mutations require a successful edit/write result. A pending call is
 * included explicitly so the pre-execution user notice describes the mutation
 * that is about to run.
 */
export function collectSnapshotInsightActivity(
  entries: readonly unknown[],
  cwd: string,
  boundaryLeafId: string | null,
  pending?: PendingSnapshotToolCall,
): SnapshotInsightActivity {
  const recognizedFiles = new Set<string>();
  const directMutationFiles = new Set<string>();
  const calls = new Map<string, ToolCallRecord>();
  const boundaryIndex = boundaryLeafId
    ? entries.findIndex(entry => isRecord(entry) && entry.id === boundaryLeafId)
    : -1;
  const boundaryOnActiveBranch = boundaryLeafId === null || boundaryIndex >= 0;
  const effectiveBoundaryIndex = boundaryOnActiveBranch ? boundaryIndex : -1;
  let shellActivity = false;

  entries.forEach((entry, entryIndex) => {
    if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) return;
    const message = entry.message;

    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isRecord(block) || block.type !== "toolCall" || typeof block.id !== "string" || typeof block.name !== "string") {
          continue;
        }
        const args = isRecord(block.arguments) ? block.arguments : {};
        const path = typeof args.path === "string" ? args.path : undefined;
        if (block.name === "read" || block.name === "edit" || block.name === "write") {
          addRecognizedPath(recognizedFiles, path, cwd);
        }
        calls.set(block.id, { toolName: block.name, path, entryIndex });
      }
      return;
    }

    if (message.role !== "toolResult" || message.isError === true || typeof message.toolCallId !== "string") return;
    const call = calls.get(message.toolCallId);
    if (!call || call.entryIndex <= effectiveBoundaryIndex) return;
    if (call.toolName === "edit" || call.toolName === "write") {
      addRecognizedPath(directMutationFiles, call.path, cwd);
    } else if (call.toolName === "bash") {
      shellActivity = true;
    }
  });

  if (pending) {
    if (pending.toolName === "read" || pending.toolName === "edit" || pending.toolName === "write") {
      addRecognizedPath(recognizedFiles, pending.path, cwd);
    }
    if (pending.toolName === "edit" || pending.toolName === "write") {
      addRecognizedPath(directMutationFiles, pending.path, cwd);
    } else if (pending.toolName === "bash") {
      shellActivity = true;
    }
  }

  return {
    recognizedFiles: [...recognizedFiles].sort(),
    directMutationFiles: [...directMutationFiles].sort(),
    shellActivity,
    boundaryOnActiveBranch,
  };
}
