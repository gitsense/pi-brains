/**
 * Debug Logger
 * 
 * Writes debug logs to a file for troubleshooting.
 * Logs are written to ~/.pi/agent/debug/pi-brains-checkpoint.log
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const LOG_DIR = join(homedir(), ".pi", "agent", "debug");
const LOG_FILE = join(LOG_DIR, "pi-brains-checkpoint.log");

// Ensure log directory exists
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch {
  // Ignore if already exists
}

/**
 * Write a debug log entry
 */
export function debugLog(message: string, data?: unknown): void {
  try {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    const line = `[${timestamp}] ${message}${dataStr}\n`;
    appendFileSync(LOG_FILE, line);
  } catch {
    // Silently fail - don't break the extension
  }
}

/**
 * Get the log file path
 */
export function getLogFilePath(): string {
  return LOG_FILE;
}

/**
 * Clear the log file
 */
export function clearLog(): void {
  try {
    appendFileSync(LOG_FILE, "\n--- New session ---\n");
  } catch {
    // Ignore
  }
}
