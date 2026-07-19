import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import type { DebugLogger } from "./debug.ts";

interface BashSessionRegistration {
  schema_version: number;
  alias: string;
  session_id: string;
  session_file: string;
  sidecar_file: string;
}

interface BrainsResponse {
  databases?: Array<{ name?: unknown }>;
}

const REGISTRATION_TIMEOUT_MS = 5_000;
const BRAINS_TIMEOUT_MS = 5_000;

export class BashObservability {
  private readonly pi: ExtensionAPI;
  private readonly debug: DebugLogger;
  private sessionFile: string | null = null;
  private registration: BashSessionRegistration | null = null;
  private registrationPromise: Promise<void> | null = null;
  private brains: string[] = [];

  constructor(pi: ExtensionAPI, debug: DebugLogger) {
    this.pi = pi;
    this.debug = debug;
  }

  bindSession(sessionFile: string | null): void {
    if (sessionFile === this.sessionFile) return;
    this.sessionFile = sessionFile;
    this.registration = null;
    this.registrationPromise = null;
  }

  async ensureRegistration(cwd: string, signal?: AbortSignal): Promise<void> {
    if (!this.sessionFile || this.registration) return;
    if (this.registrationPromise) return this.registrationPromise;

    const sessionFile = this.sessionFile;
    this.registrationPromise = this.register(sessionFile, cwd, signal).finally(() => {
      this.registrationPromise = null;
    });
    return this.registrationPromise;
  }

  async refreshBrains(cwd: string, signal?: AbortSignal): Promise<void> {
    try {
      const result = await this.pi.exec("gsc", ["brains", "--json"], {
        cwd,
        signal,
        timeout: BRAINS_TIMEOUT_MS,
      });
      if (result.code !== 0) {
        this.brains = [];
        this.debug.log(`gsc brains discovery failed with exit code ${result.code}`);
        return;
      }
      const parsed = JSON.parse(result.stdout) as BrainsResponse;
      this.brains = [...new Set((parsed.databases ?? [])
        .map(database => database.name)
        .filter((name): name is string => typeof name === "string" && name.length > 0))].sort();
    } catch (error) {
      this.brains = [];
      this.debug.log(`gsc brains discovery failed: ${String(error)}`);
    }
  }

  getInstruction(): string | null {
    const alias = this.registration?.alias;
    if (!alias) return null;
    return `Observable shell discovery is available for this Pi session.
Use gsc bash -s ${alias} <command> for supported discovery commands: rg, grep, find, ls, head, tail, wc, sort, and uniq.

Avoid: rg pattern .
Use:   gsc bash -s ${alias} rg pattern .

Keep shell operators outside the wrapper and wrap every supported segment separately.
Avoid: rg pattern . | head -n 50
Use:   gsc bash -s ${alias} rg pattern . | gsc bash -s ${alias} head -n 50

Everything after the supported command name is passed directly to that command. Do not add -- before its options.
Avoid: gsc bash -s ${alias} rg pattern file.go -- -C 3
Use:   gsc bash -s ${alias} rg -C 3 pattern file.go
Use -- only when the underlying command intentionally needs option termination.

Native GitSense discovery such as gsc query and gsc tree does not need the bash wrapper.
This preserves exact search intent, working directory, file evidence, pipeline truncation, and brains available during discovery. Rules may require or recommend this form.`;
  }

  decorateToolCall(event: ToolCallEvent): boolean {
    if (event.toolName !== "bash" || !this.registration) return false;
    const input = event.input as Record<string, unknown>;
    const command = input.command;
    if (typeof command !== "string" || command.length === 0) return false;

    const values: Record<string, string> = {
      GSC_BASH_AGENT: "pi",
      GSC_BASH_TOOL_CALL_ID: event.toolCallId,
      GSC_BASH_COMPOSITION_ID: randomUUID(),
    };
    if (this.brains.length > 0) values.GSC_BASH_BRAINS = this.brains.join(",");

    const assignments = Object.entries(values)
      .map(([name, value]) => `${name}=${shellQuote(value)}`)
      .join(" ");
    input.command = `export ${assignments};\n${command}`;
    return true;
  }

  getAlias(): string | null {
    return this.registration?.alias ?? null;
  }

  private async register(sessionFile: string, cwd: string, signal?: AbortSignal): Promise<void> {
    try {
      const result = await this.pi.exec(
        "gsc",
        ["bash", "register", "--session-file", sessionFile, "--format", "json"],
        { cwd, signal, timeout: REGISTRATION_TIMEOUT_MS },
      );
      if (result.code !== 0) {
        this.debug.log(`gsc bash registration failed with exit code ${result.code}`);
        return;
      }
      const parsed = JSON.parse(result.stdout) as Partial<BashSessionRegistration>;
      if (!isRegistration(parsed, sessionFile)) {
        this.debug.log("gsc bash registration returned an invalid response");
        return;
      }
      if (this.sessionFile === sessionFile) {
        this.registration = parsed;
        this.debug.log(`gsc bash session registered: ${parsed.alias}`);
      }
    } catch (error) {
      this.debug.log(`gsc bash registration failed: ${String(error)}`);
    }
  }
}

function isRegistration(
  value: Partial<BashSessionRegistration>,
  sessionFile: string,
): value is BashSessionRegistration {
  return value.schema_version === 1
    && typeof value.alias === "string"
    && /^[a-z0-9]{4,32}$/.test(value.alias)
    && typeof value.session_id === "string"
    && value.session_id.length > 0
    && typeof value.session_file === "string"
    && resolve(value.session_file) === resolve(sessionFile)
    && typeof value.sidecar_file === "string"
    && value.sidecar_file.length > 0;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
