import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ContextState, ModelState } from "./types.ts";

// Guide checkpoint types (schema v1)

export type GuideCheckpointSource = "agent_marker" | "manual";
export type GuideCheckpointReason = "agent_requested" | "manual_checkpoint";

export interface GuideCheckpointFacts {
  trackedFileCount: number;
  filesChangedSinceLastCheckpoint: number;
  toolCallsSinceLastCheckpoint: number;
  failedToolCallsSinceLastCheckpoint: number;
  rulesTriggeredSinceLastCheckpoint: number;
  latestToolName: string | null;
  latestRuleId: string | null;
}

export interface GuideCheckpointCounters {
  agentMarkersDetected: number;
  agentMarkersRemoved: number;
  manualCheckpoints: number;
  checkpointsRequested: number;
}

export interface GuideWorkStateEventV1 {
  type: "work_state";
  schemaVersion: 1;
  checkpointId: string;
  previousCheckpointId: string | null;
  source: GuideCheckpointSource;
  reason: GuideCheckpointReason;
  phase: "checkpoint_requested";
  summary: string;
  guideEnabled: boolean;
  sessionId: string | null;
  leafId: string | null;
  anchorLeafId: string | null;
  facts: GuideCheckpointFacts;
  counters: GuideCheckpointCounters;
  context: ContextState | null;
  model: ModelState | null;
}

// Checkpoint payload types

export interface GuideCheckpointPayloadTool {
  toolCallId: string | null;
  toolName: string;
  target: string | null;
  isError: boolean;
  timestamp: string;
}

export interface GuideCheckpointPayloadRule {
  ruleId: string | null;
  ruleType: string | null;
  outcome: string | null;
  blocked: boolean | null;
  timestamp: string;
}

export interface GuideCheckpointPayloadGuideEvent {
  type: string;
  timestamp: string;
  leafId: string | null;
}

export interface GuideCheckpointPayloadFiles {
  tracked: string[];
  changedSinceLastCheckpoint: string[];
}

export interface GuideCheckpointPayloadTools {
  sinceLastCheckpoint: GuideCheckpointPayloadTool[];
}

export interface GuideCheckpointPayloadRules {
  sinceLastCheckpoint: GuideCheckpointPayloadRule[];
}

export interface GuideCheckpointPayloadGuideEvents {
  recent: GuideCheckpointPayloadGuideEvent[];
}

export interface GuideCheckpointPayloadEventV1 {
  type: "checkpoint_payload";
  schemaVersion: 1;
  checkpointId: string;
  previousCheckpointId: string | null;
  source: GuideCheckpointSource;
  reason: GuideCheckpointReason;
  guideEnabled: boolean;
  sessionId: string | null;
  leafId: string | null;
  anchorLeafId: string | null;
  files: GuideCheckpointPayloadFiles;
  tools: GuideCheckpointPayloadTools;
  rules: GuideCheckpointPayloadRules;
  guideEvents: GuideCheckpointPayloadGuideEvents;
  context: ContextState | null;
  model: ModelState | null;
}

const MAX_RECENT_GUIDE_EVENTS = 20;

/**
 * Checkpoint event logger.
 * Writes JSONL events to a deterministic path near the active session.
 */
export class CheckpointLog {
  private logFilePath: string | null = null;
  private sessionId: string | null = null;
  private leafId: string | null = null;
  private recentEvents: GuideCheckpointPayloadGuideEvent[] = [];

  /**
   * Set the session context for debug logging.
   */
  setSession(sessionFile: string | null, sessionId: string | null, leafId: string | null): void {
    this.sessionId = sessionId;
    this.leafId = leafId;

    if (sessionFile) {
      // Use deterministic path: <session-file-without-.jsonl>.checkpoints.jsonl
      this.logFilePath = sessionFile.replace(/\.jsonl$/, ".checkpoints.jsonl");
    } else {
      // Fallback to timestamp-based path
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      this.logFilePath = join(".gitsense", "debug", `guide-${timestamp}.jsonl`);
    }
  }

  /**
   * Update the leaf ID (changes as the session tree evolves).
   */
  setLeafId(leafId: string | null): void {
    this.leafId = leafId;
  }

  /**
   * Get the current log file path.
   */
  getLogFilePath(): string | null {
    return this.logFilePath;
  }

  /**
   * Get the current session ID.
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get the current leaf ID.
   */
  getLeafId(): string | null {
    return this.leafId;
  }

  /**
   * Get recent guide events for checkpoint payload.
   */
  getRecentEvents(): GuideCheckpointPayloadGuideEvent[] {
    return [...this.recentEvents];
  }

  /**
   * Record a guide event in the recent events ring buffer.
   */
  private recordRecentEvent(type: string): void {
    const event: GuideCheckpointPayloadGuideEvent = {
      type,
      timestamp: new Date().toISOString(),
      leafId: this.leafId,
    };

    this.recentEvents.push(event);
    if (this.recentEvents.length > MAX_RECENT_GUIDE_EVENTS) {
      this.recentEvents.shift();
    }
  }

  /**
   * Write a guide debug event.
   */
  logEvent(event: {
    type: string;
    guideEnabled: boolean;
    [key: string]: unknown;
  }): void {
    if (!this.logFilePath) return;

    try {
      const dir = dirname(this.logFilePath);
      mkdirSync(dir, { recursive: true });

      const entry = {
        ...event,
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        leafId: this.leafId,
      };

      appendFileSync(this.logFilePath, JSON.stringify(entry) + "\n");

      // Record in recent events ring buffer
      this.recordRecentEvent(event.type);
    } catch {
      // Silently fail - don't break the agent session
    }
  }

  /**
   * Log when the checkpoint log is initialized for a session.
   * Uses checkpoint_log_initialized for new sessions.
   */
  logInitialized(guideEnabled: boolean): void {
    this.logEvent({
      type: "checkpoint_log_initialized",
      guideEnabled,
      logFilePath: this.logFilePath,
    });
  }

  /**
   * Log a guide enabled event.
   */
  logGuideEnabled(): void {
    this.logEvent({ type: "guide_enabled", guideEnabled: true });
  }

  /**
   * Log a guide disabled event.
   */
  logGuideDisabled(): void {
    this.logEvent({ type: "guide_disabled", guideEnabled: false });
  }

  /**
   * Log a guidance injected event.
   */
  logGuidanceInjected(): void {
    this.logEvent({ type: "guidance_injected", guideEnabled: true });
  }

  /**
   * Log a message_end seen event.
   */
  logMessageEndSeen(role: string, hasMarker: boolean): void {
    this.logEvent({
      type: "message_end_seen",
      guideEnabled: true,
      role,
      hasMarker,
    });
  }

  /**
   * Log a marker detected event.
   */
  logMarkerDetected(messageRole: string): void {
    this.logEvent({
      type: "marker_detected",
      guideEnabled: true,
      messageRole,
    });
  }

  /**
   * Log a marker removed event.
   */
  logMarkerRemoved(success: boolean): void {
    this.logEvent({
      type: "marker_removed",
      guideEnabled: true,
      success,
    });
  }

  /**
   * Log a marker remove failed event.
   */
  logMarkerRemoveFailed(error: string): void {
    this.logEvent({
      type: "marker_remove_failed",
      guideEnabled: true,
      error,
    });
  }

  /**
   * Log a debug log error event.
   */
  logDebugLogError(error: string): void {
    try {
      this.logEvent({
        type: "debug_log_error",
        guideEnabled: true,
        error,
      });
    } catch {
      // Last resort - don't let debug logging failures break anything
    }
  }

  /**
   * Log a schema v1 work_state checkpoint event.
   */
  logWorkStateV1(event: GuideWorkStateEventV1): void {
    this.logEvent({
      ...event,
      guideEnabled: true,
    });
  }

  /**
   * Log a schema v1 checkpoint_payload event.
   */
  logCheckpointPayloadV1(event: GuideCheckpointPayloadEventV1): void {
    this.logEvent({
      ...event,
      guideEnabled: true,
    });
  }

  /**
   * Log checkpoint message started event.
   */
  logCheckpointMessageStarted(data: {
    checkpointId: string;
    anchorLeafId: string | null;
    originalLeafId: string | null;
    sourceSessionPath: string | null;
  }): void {
    this.logEvent({
      type: "checkpoint_message_started",
      guideEnabled: true,
      customType: "guide-checkpoint-request",
      triggerTurn: false,
      ...data,
    });
  }

  /**
   * Log checkpoint message created event.
   */
  logCheckpointMessageCreated(data: {
    checkpointId: string;
    anchorLeafId: string | null;
    originalLeafId: string | null;
    sourceSessionPath: string | null;
  }): void {
    this.logEvent({
      type: "checkpoint_message_created",
      guideEnabled: true,
      customType: "guide-checkpoint-request",
      triggerTurn: false,
      ...data,
    });
  }

  /**
   * Log checkpoint message restored event.
   */
  logCheckpointMessageRestored(data: {
    checkpointId: string;
    anchorLeafId: string | null;
    originalLeafId: string | null;
    sourceSessionPath: string | null;
  }): void {
    this.logEvent({
      type: "checkpoint_message_restored",
      guideEnabled: true,
      customType: "guide-checkpoint-request",
      triggerTurn: false,
      ...data,
    });
  }

  /**
   * Log checkpoint message failed event.
   */
  logCheckpointMessageFailed(data: {
    checkpointId: string;
    anchorLeafId: string | null;
    originalLeafId: string | null;
    sourceSessionPath: string | null;
    error: string;
  }): void {
    this.logEvent({
      type: "checkpoint_message_failed",
      guideEnabled: true,
      customType: "guide-checkpoint-request",
      triggerTurn: false,
      ...data,
    });
  }

  /**
   * Log checkpoint suggested event (when agent emits marker).
   */
  logCheckpointSuggested(data: {
    suggestionId: string;
    leafId: string | null;
    anchorLeafId: string | null;
    pending: boolean;
    suggestionCount: number;
  }): void {
    this.logEvent({
      type: "checkpoint_suggested",
      guideEnabled: true,
      source: "agent_marker",
      ...data,
    });
  }

  /**
   * Log checkpoint suggestion consumed event.
   */
  logCheckpointSuggestionConsumed(data: {
    suggestionId: string;
    checkpointId: string;
  }): void {
    this.logEvent({
      type: "checkpoint_suggestion_consumed",
      guideEnabled: true,
      ...data,
    });
  }

  /**
   * Log checkpoint failed event.
   */
  logCheckpointFailed(data: {
    checkpointId: string;
    error: string;
    pendingSuggestion: boolean;
  }): void {
    this.logEvent({
      type: "checkpoint_failed",
      guideEnabled: true,
      ...data,
    });
  }
}
