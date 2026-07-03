import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PiBrainsConfig } from "./types.ts";

export class DebugLogger {
  private getConfig: () => PiBrainsConfig;
  private logFilePath: string | null = null;

  constructor(getConfig: () => PiBrainsConfig) {
    this.getConfig = getConfig;
  }

  isEnabled(): boolean {
    return this.getConfig().debug;
  }

  /**
   * Returns the absolute path to the current debug log file.
   * Creates the file on first call when debug is enabled.
   */
  getLogFilePath(): string {
    if (!this.logFilePath) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const relativePath = join(".gitsense", "debug", `pi-brains-${timestamp}.log`);
      this.logFilePath = resolve(relativePath);
    }
    return this.logFilePath;
  }

  log(message: string, ...args: unknown[]): void {
    if (this.getConfig().debug) {
      this.writeToFile("[pi-brains] " + message, args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.getConfig().debug) {
      this.writeToFile("[pi-brains:warn] " + message, args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.getConfig().debug) {
      this.writeToFile("[pi-brains:error] " + message, args);
    }
  }

  private writeToFile(message: string, args: unknown[]): void {
    try {
      const logPath = this.getLogFilePath();
      const dir = logPath.substring(0, logPath.lastIndexOf("/"));
      
      // Create directory if it doesn't exist
      mkdirSync(dir, { recursive: true });
      
      // Format the message with args
      let formattedMessage = message;
      if (args.length > 0) {
        formattedMessage += " " + args.map(arg => 
          typeof arg === "object" ? JSON.stringify(arg) : String(arg)
        ).join(" ");
      }
      
      // Add timestamp
      const timestamp = new Date().toISOString();
      const logLine = `${timestamp} ${formattedMessage}\n`;
      
      // Append to file
      appendFileSync(logPath, logLine);
    } catch {
      // Silently fail - don't break the extension if logging fails
    }
  }
}
