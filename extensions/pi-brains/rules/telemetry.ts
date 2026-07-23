import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DebugLogger } from "../debug.ts";

// ─── Event Schema ──────────────────────────────────────────────────────────────

export const RULE_TELEMETRY_SCHEMA_VERSION = 1;

export type RuleTelemetryOutcome =
  | "matched"
  | "executed"
  | "triggered"
  | "blocked"
  | "delivery_paused"
  | "skipped"
  | "error"
  | "delivered";

export interface RuleTelemetrySession {
  id: string | null;
  path: string;
  cwd: string;
  entryId: string | null;
  parentId: string | null;
  leafId: string | null;
}

export interface RuleTelemetryEvent {
  lifecycle: string;
  action: string;
  toolName: string;
  toolCallId: string | null;
  command: string | null;
  filePath: string | null;
  normalizedFile: string | null;
  repoRoot: string | null;
}

export interface RuleTelemetryRuleSnapshot {
  id: string;
  hash: string;
  triggerHash: string | null;
  type: "declarative" | "executable";
  source: string;
  summary: string;
  instructions: string[];
  event: string;
  priority: number;
  importance: string;
  frequencyMode: string | null;
}

export interface RuleTelemetryMatch {
  kind: string;
  value: string;
  file: string | null;
  action: string | null;
}

export interface RuleTelemetryResult {
  outcome: RuleTelemetryOutcome;
  matched: boolean;
  executed: boolean;
  triggerMatched: boolean;
  blocked: boolean;
  deliveryPaused: boolean;
  policyBlocked: boolean;
  skipped: boolean;
  delivered: boolean;
  deliveryMode: string | null;
  durationMs: number | null;
  notice: string | null;
  message: string | null;
  error: string | null;
}

export interface RuleTelemetryEventV1 {
  schemaVersion: typeof RULE_TELEMETRY_SCHEMA_VERSION;
  type: "rule_event";
  id: string;
  timestamp: string;
  session: RuleTelemetrySession;
  event: RuleTelemetryEvent;
  rule: RuleTelemetryRuleSnapshot;
  match: RuleTelemetryMatch;
  result: RuleTelemetryResult;
}

// ─── ID Generation ─────────────────────────────────────────────────────────────

function generateEventId(): string {
  return `ruleevt_${randomUUID()}`;
}

// ─── Sidecar Path Derivation ───────────────────────────────────────────────────

export function deriveSidecarPath(sessionPath: string): string {
  if (sessionPath.endsWith(".jsonl")) {
    return sessionPath.replace(/\.jsonl$/, ".rules.jsonl");
  }
  return sessionPath + ".rules.jsonl";
}

// ─── Telemetry Writer ──────────────────────────────────────────────────────────

export class RuleTelemetryWriter {
  private sessionPath: string | null = null;
  private sidecarPath: string | null = null;
  private readonly debug: DebugLogger;

  constructor(debug: DebugLogger) {
    this.debug = debug;
  }

  /**
   * Set the current session path. Derives the sidecar path automatically.
   */
  setSession(sessionPath: string | null): void {
    if (sessionPath) {
      this.sessionPath = sessionPath;
      this.sidecarPath = deriveSidecarPath(sessionPath);
      this.debug.log(`telemetry session set: ${this.sidecarPath}`);
    } else {
      this.sessionPath = null;
      this.sidecarPath = null;
      this.debug.log("telemetry session cleared");
    }
  }

  /**
   * Write a telemetry event to the sidecar file.
   * Returns true if written, false if skipped (no session path).
   */
  async write(event: RuleTelemetryEventV1): Promise<boolean> {
    if (!this.sidecarPath) {
      this.debug.log("rule telemetry skipped: session path unavailable");
      return false;
    }

    try {
      // Ensure directory exists
      const dir = dirname(this.sidecarPath);
      mkdirSync(dir, { recursive: true });

      // Append JSONL line
      const line = JSON.stringify(event) + "\n";
      appendFileSync(this.sidecarPath, line, "utf8");

      this.debug.log(`rule telemetry written: ${this.sidecarPath} rule=${event.rule.id} outcome=${event.result.outcome}`);
      return true;
    } catch (error) {
      this.debug.log(`rule telemetry write failed: ${error}`);
      return false;
    }
  }

  /**
   * Get the current sidecar path (for testing/debugging).
   */
  getSidecarPath(): string | null {
    return this.sidecarPath;
  }
}

// ─── Event Builder ─────────────────────────────────────────────────────────────

interface BuildEventInput {
  session: RuleTelemetrySession;
  event: RuleTelemetryEvent;
  rule: RuleTelemetryRuleSnapshot;
  match: RuleTelemetryMatch;
  result: RuleTelemetryResult;
}

export function buildTelemetryEvent(input: BuildEventInput): RuleTelemetryEventV1 {
  return {
    schemaVersion: RULE_TELEMETRY_SCHEMA_VERSION,
    type: "rule_event",
    id: generateEventId(),
    timestamp: new Date().toISOString(),
    session: input.session,
    event: input.event,
    rule: input.rule,
    match: input.match,
    result: input.result,
  };
}

// ─── Outcome Resolution ────────────────────────────────────────────────────────

/**
 * Determine the final outcome from boolean flags.
 * Priority: error > policy block > delivery pause > triggered > executed > delivered > matched > skipped
 */
export function resolveOutcome(flags: {
  hasError: boolean;
  blocked: boolean;
  deliveryPaused?: boolean;
  triggerMatched: boolean;
  executed: boolean;
  delivered: boolean;
  matched: boolean;
  skipped: boolean;
}): RuleTelemetryOutcome {
  if (flags.hasError) return "error";
  if (flags.blocked) return "blocked";
  if (flags.deliveryPaused) return "delivery_paused";
  if (flags.triggerMatched) return "triggered";
  if (flags.executed) return "executed";
  if (flags.delivered) return "delivered";
  if (flags.matched) return "matched";
  return "skipped";
}
