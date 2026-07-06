import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Debug logger specifically for guide mode.
 * Writes JSONL events to a deterministic path near the active session.
 */
export class GuideDebugLogger {
  private logFilePath: string | null = null;
  private sessionId: string | null = null;
  private leafId: string | null = null;

  /**
   * Set the session context for debug logging.
   */
  setSession(sessionFile: string | null, sessionId: string | null, leafId: string | null): void {
    this.sessionId = sessionId;
    this.leafId = leafId;

    if (sessionFile) {
      // Use deterministic path: <session-file-without-.jsonl>.guide-debug.jsonl
      this.logFilePath = sessionFile.replace(/\.jsonl$/, ".guide-debug.jsonl");
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
    } catch {
      // Silently fail - don't break the agent session
    }
  }

  /**
   * Log when the guide debug log is initialized for a session.
   */
  logInitialized(guideEnabled: boolean): void {
    this.logEvent({
      type: "guide_log_initialized",
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
   * Log a deterministic Work State checkpoint event.
   * Called when [PI_WORKSTATE_REQUEST] marker is detected and removed.
   * No LLM involved — derived only from already-available facts.
   */
  logWorkStateRequested(data: {
    latestEventType?: string;
    markersDetected?: number;
    markersRemoved?: number;
    trackedFileCount?: number;
    context?: { tokens: number | null; contextWindow: number; percent: number | null } | null;
    model?: { id: string; provider: string; thinkingLevel: string } | null;
  }): void {
    this.logEvent({
      type: "work_state",
      guideEnabled: true,
      reason: "agent_requested",
      phase: "checkpoint_requested",
      summary: "Agent requested a Work State checkpoint.",
      latestEventType: data.latestEventType ?? null,
      markersDetected: data.markersDetected ?? 0,
      markersRemoved: data.markersRemoved ?? 0,
      trackedFileCount: data.trackedFileCount ?? 0,
      context: data.context ?? null,
      model: data.model ?? null,
    });
  }

  /**
   * Log a synthetic test work_state event for pipeline verification.
   * Used by /brains guide test to verify write→parse→display works.
   */
  logTestWorkState(): void {
    // Simulate marker detection
    this.logEvent({
      type: "marker_detected",
      guideEnabled: true,
      messageRole: "assistant",
    });

    // Simulate marker removal
    this.logEvent({
      type: "marker_removed",
      guideEnabled: true,
      success: true,
    });

    // Write work_state event
    this.logEvent({
      type: "work_state",
      guideEnabled: true,
      reason: "manual_test",
      phase: "checkpoint_requested",
      summary: "Manual guide test checkpoint.",
      latestEventType: "guide_test",
      markersDetected: 0,
      markersRemoved: 0,
      trackedFileCount: 0,
      context: null,
      model: null,
    });
  }
}
