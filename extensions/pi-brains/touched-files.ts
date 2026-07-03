import { isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";

interface ToolCallRecord {
  name: string;
  path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expandTilde(path: string): string {
  if (path === "~" || path.startsWith("~/")) {
    return homedir() + path.slice(1);
  }
  return path;
}

function normalizePath(path: string, cwd: string): string {
  const expanded = expandTilde(path);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

function structuredPath(toolName: string, input: Record<string, unknown>): string | undefined {
  if (toolName !== "read" && toolName !== "edit" && toolName !== "write") return undefined;
  return typeof input.path === "string" ? input.path : undefined;
}

export class TouchedFileTracker {
  private readonly files = new Set<string>();
  private shellActivity = false;

  recordResult(event: ToolResultEvent, cwd: string): boolean {
    if (event.toolName === "bash") {
      this.shellActivity = true;
      return false;
    }
    if (event.isError) return false;
    const path = structuredPath(event.toolName, event.input);
    if (!path) return false;
    const previousSize = this.files.size;
    this.files.add(normalizePath(path, cwd));
    return this.files.size !== previousSize;
  }

  replay(entries: readonly unknown[], cwd: string): void {
    const calls = new Map<string, ToolCallRecord>();

    for (const entry of entries) {
      if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue;
      const message = entry.message;

      if (message.role === "assistant" && Array.isArray(message.content)) {
        for (const block of message.content) {
          if (!isRecord(block) || block.type !== "toolCall") continue;
          if (typeof block.id !== "string" || typeof block.name !== "string" || !isRecord(block.arguments)) continue;
          const path = structuredPath(block.name, block.arguments);
          if (path) calls.set(block.id, { name: block.name, path });
          if (block.name === "bash") this.shellActivity = true;
        }
        continue;
      }

      if (message.role !== "toolResult" || message.isError === true || typeof message.toolCallId !== "string") continue;
      const call = calls.get(message.toolCallId);
      if (call) this.files.add(normalizePath(call.path, cwd));
    }
  }

  getFiles(): ReadonlySet<string> {
    return this.files;
  }

  hasShellActivity(): boolean {
    return this.shellActivity;
  }
}
