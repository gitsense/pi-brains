/**
 * Checkpoint Handler
 * 
 * Handles the /brains checkpoint command.
 * Requests a checkpoint by:
 * 1. Showing confirmation UI
 * 2. Sending generation instructions on a scratch branch
 * 3. Letting the agent write, validate, and append semantic checkpoint data
 * 4. Independently verifying the persisted record
 * 5. Committing controller bookkeeping only after verification
 * 6. Offering to navigate back to the main branch
 */

import type { ExtensionAPI, ExtensionCommandContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import type { PiBrainsController } from "./controller.ts";

const CHECKPOINT_BRANCH_ENTRY_TYPE = "guide-checkpoint-branch";
const CHECKPOINT_RETURN_ENTRY_TYPE = "guide-checkpoint-returned";

export interface CheckpointReturnAnchor {
  checkpointId: string;
  originalLeafId: string;
  branchEntryId: string;
}

// State for tracking checkpoint branch
let inCheckpointBranch = false;
let checkpointOriginalLeafId: string | null = null;
// Retained after generation and reconstructed from custom entries on reload.
let checkpointReturnAnchor: CheckpointReturnAnchor | null = null;
let checkpointCtx: ExtensionCommandContext | null = null;
let checkpointController: PiBrainsController | null = null;
let checkpointPendingId: string | null = null;
let checkpointCwd: string | null = null;
let checkpointPendingIdentity: CheckpointIdentity | null = null;

/**
 * Initialize checkpoint event handlers
 */
export function initCheckpointHandlers(pi: ExtensionAPI): void {
  // Reconstruct an outstanding return anchor after extension reload/session resume.
  pi.on("session_start", (_event, ctx) => {
    inCheckpointBranch = false;
    checkpointOriginalLeafId = null;
    checkpointCtx = null;
    checkpointController = null;
    checkpointPendingId = null;
    checkpointCwd = null;
    checkpointPendingIdentity = null;
    checkpointReturnAnchor = findPendingCheckpointReturnAnchor(
      ctx.sessionManager.getEntries(),
      ctx.sessionManager.getLeafId(),
    );
  });

  // Wait until the entire agent run has settled. Unlike agent_end, this fires
  // after retries, compaction, and queued continuations have finished and Pi
  // has left its active-run state, so tree navigation is safe.
  pi.on("agent_settled", async (_event, _ctx) => {
    if (inCheckpointBranch && checkpointOriginalLeafId && checkpointCtx && checkpointController && checkpointPendingId && checkpointCwd && checkpointPendingIdentity) {
      
      // Hide the working indicator
      checkpointCtx.ui.setWorkingVisible(false);

      let verified = false;
      let verificationError = "";
      try {
        await verifyCheckpoint(checkpointPendingIdentity, checkpointCwd);
        verified = checkpointController.completeGuideCheckpoint(checkpointPendingId);
        if (!verified) {
          throw new Error("checkpoint request state was not found");
        }
        checkpointCtx.ui.notify(`✓ Checkpoint created: ${checkpointPendingId}`, "info");
      } catch (error) {
        verificationError = error instanceof Error ? error.message : String(error);
        checkpointController.failGuideCheckpoint(checkpointPendingId, verificationError);
        checkpointCtx.ui.notify(`✗ Checkpoint failed: ${verificationError}`, "error");
      }
      
      const returnAnchor = checkpointReturnAnchor;

      // Show selection dialog
      const choice = await checkpointCtx.ui.select(
        verified ? "Checkpoint Created" : "Checkpoint Failed",
        [
          "Return to main branch",
          "Stay on checkpoint branch"
        ]
      );
      
      if (choice === "Return to main branch" && returnAnchor) {
        
        try {
          const result = await checkpointCtx.navigateTree(returnAnchor.originalLeafId, { summarize: false });
          if (result.cancelled || checkpointCtx.sessionManager.getLeafId() !== returnAnchor.originalLeafId) {
            throw new Error(result.cancelled ? "tree navigation was cancelled" : "tree navigation did not reach the return anchor");
          }
          pi.appendEntry(CHECKPOINT_RETURN_ENTRY_TYPE, buildCheckpointReturnMarker(returnAnchor));
          checkpointReturnAnchor = null;
          checkpointCtx.ui.notify("Returned to main branch", "info");
        } catch (error) {
          // Preserve the anchor so the explicit exit command can retry.
          checkpointReturnAnchor = returnAnchor;
          checkpointCtx.ui.notify("Could not return to main branch. Run '/brains checkpoint exit' to retry.", "warning");
        }
      } else {
        checkpointCtx.ui.notify("Stay on checkpoint branch. Run '/brains checkpoint exit' to return later.", "info");
      }
      
      // Reset generation state, but retain the return anchor when the user
      // stayed on the checkpoint branch or navigation failed.
      inCheckpointBranch = false;
      checkpointOriginalLeafId = null;
      checkpointCtx = null;
      checkpointController = null;
      checkpointPendingId = null;
      checkpointCwd = null;
      checkpointPendingIdentity = null;
    }
  });
}

// Types

export interface CheckpointOptions {
  pi: ExtensionAPI;
  ctx: ExtensionCommandContext;
  controller: PiBrainsController;
  sessionId: string;
  sessionFile: string | null;
  leafId: string | null;
  cwd: string;
}

export interface CheckpointResult {
  success: boolean;
  checkpointId?: string;
  error?: string;
}

export interface CheckpointIdentity {
  checkpointId: string;
  sessionId: string;
  agent: "pi";
  nativeSessionId: string;
  entryId: string;
  anchorLeafId: string;
  repoPath: string;
}

/** Model-hidden custom-entry data that marks the checkpoint child branch. */
export function buildCheckpointBranchMarker(identity: CheckpointIdentity, originalLeafId: string): {
  schemaVersion: 1;
  checkpointId: string;
  originalLeafId: string;
  scratch: true;
} {
  return {
    schemaVersion: 1,
    checkpointId: identity.checkpointId,
    originalLeafId,
    scratch: true,
  };
}

/** Model-hidden custom-entry data that closes a checkpoint branch. */
export function buildCheckpointReturnMarker(anchor: CheckpointReturnAnchor): {
  schemaVersion: 1;
  checkpointId: string;
  originalLeafId: string;
  branchEntryId: string;
} {
  return {
    schemaVersion: 1,
    checkpointId: anchor.checkpointId,
    originalLeafId: anchor.originalLeafId,
    branchEntryId: anchor.branchEntryId,
  };
}

/** Find the newest unresolved checkpoint marker on the active tree path. */
export function findPendingCheckpointReturnAnchor(
  entries: readonly SessionEntry[],
  leafId: string | null,
): CheckpointReturnAnchor | null {
  if (!leafId) return null;

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const activePathIds = new Set<string>();
  let current = byId.get(leafId);
  while (current) {
    activePathIds.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  const returnedBranches = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== CHECKPOINT_RETURN_ENTRY_TYPE) continue;
    const data = readCheckpointEntryData(entry.data);
    if (data?.schemaVersion === 1 && typeof data.checkpointId === "string" && typeof data.branchEntryId === "string") {
      returnedBranches.set(data.branchEntryId, data.checkpointId);
    }
  }

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (!activePathIds.has(entry.id)) continue;
    const data = readCheckpointBranchEntryData(entry);
    if (!data || data.scratch !== true ||
        typeof data.checkpointId !== "string" || typeof data.originalLeafId !== "string" ||
        entry.parentId !== data.originalLeafId || !byId.has(data.originalLeafId) ||
        returnedBranches.get(entry.id) === data.checkpointId) continue;
    return {
      checkpointId: data.checkpointId,
      originalLeafId: data.originalLeafId,
      branchEntryId: entry.id,
    };
  }
  return null;
}

function readCheckpointBranchEntryData(entry: SessionEntry): Record<string, unknown> | null {
  if (entry.type === "custom" && entry.customType === CHECKPOINT_BRANCH_ENTRY_TYPE) {
    const data = readCheckpointEntryData(entry.data);
    return data?.schemaVersion === 1 ? data : null;
  }
  // Compatibility with the short-lived custom-message marker used before the
  // model-hidden custom-entry protocol. This lets `/reload` recover its anchor.
  if (entry.type === "custom_message" && entry.customType === CHECKPOINT_BRANCH_ENTRY_TYPE) {
    return readCheckpointEntryData(entry.details);
  }
  return null;
}

function readCheckpointEntryData(data: unknown): Record<string, unknown> | null {
  return typeof data === "object" && data !== null ? data as Record<string, unknown> : null;
}

// Main handler

/**
 * Handle /brains checkpoint command
 */
export async function handleCheckpoint(options: CheckpointOptions): Promise<CheckpointResult> {
  const { pi, ctx, controller, sessionId, sessionFile, leafId, cwd } = options;
  
  
  if (inCheckpointBranch) {
    return { success: false, error: "A checkpoint is already being generated" };
  }
  if (checkpointReturnAnchor) {
    return { success: false, error: "Exit the current checkpoint branch before creating another checkpoint" };
  }
  if (!sessionFile) {
    return { success: false, error: "No session file" };
  }
  if (!leafId) {
    return { success: false, error: "No leaf ID available" };
  }
  if (!ctx.sessionManager.getLeafId()) {
    return { success: false, error: "No original leaf ID" };
  }

  // Confirm before creating request state or resetting any counters.
  const confirmed = await ctx.ui.confirm(
    "Create Checkpoint",
    `Create checkpoint for session ${sessionId.slice(0, 12)}...?`
  );
  
  if (!confirmed) {
    return { success: false, error: "cancelled" };
  }
  
  
  const checkpointResult = controller.requestGuideCheckpoint("manual");
  const checkpointId = checkpointResult.checkpointId;

  const identity: CheckpointIdentity = {
    checkpointId,
    sessionId,
    agent: "pi",
    nativeSessionId: sessionId,
    entryId: leafId,
    anchorLeafId: leafId,
    repoPath: cwd,
  };
  let instructions: string;
  try {
    instructions = await loadCheckpointGuide(identity, cwd);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    controller.failGuideCheckpoint(checkpointId, message);
    return { success: false, checkpointId, error: message };
  }
  
  // Step 2: Create scratch branch and send instructions
  return await createCheckpointBranch(
    pi,
    ctx,
    controller,
    sessionFile,
    leafId,
    cwd,
    identity,
    instructions,
  );
}

// Execution

/**
 * Create scratch branch and send checkpoint instructions
 */
async function createCheckpointBranch(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  controller: PiBrainsController,
  sessionFile: string | null,
  leafId: string,
  cwd: string,
  identity: CheckpointIdentity,
  instructions: string,
): Promise<CheckpointResult> {
  if (!sessionFile) {
    return { success: false, error: "No session file" };
  }
  
  if (!leafId) {
    return { success: false, error: "No leaf ID" };
  }
  
  const originalLeafId = ctx.sessionManager.getLeafId();
  if (!originalLeafId) {
    return { success: false, error: "No original leaf ID" };
  }
  if (originalLeafId !== leafId) {
    const error = "Session leaf changed while preparing checkpoint instructions";
    controller.failGuideCheckpoint(identity.checkpointId, error);
    return { success: false, checkpointId: identity.checkpointId, error };
  }
  
  try {
    // The current leaf is the main-branch anchor. Appending a hidden marker
    // under it creates an explicit child branch without changing the main
    // conversation's history or creating a separate Pi session file.
    
    // 2. Set state for tracking checkpoint branch
    inCheckpointBranch = true;
    checkpointOriginalLeafId = originalLeafId;
    checkpointCtx = ctx;
    checkpointController = controller;
    checkpointPendingId = identity.checkpointId;
    checkpointCwd = cwd;
    checkpointPendingIdentity = identity;
    
    // 3. Append a model-hidden custom entry, then send the instructions as a
    // user message. The instructions become a child of the marker, while the
    // marker itself does not participate in LLM context.
    pi.appendEntry(CHECKPOINT_BRANCH_ENTRY_TYPE, buildCheckpointBranchMarker(identity, originalLeafId));
    const branchEntryId = ctx.sessionManager.getLeafId();
    if (!branchEntryId || branchEntryId === originalLeafId) {
      throw new Error("Checkpoint branch marker was not appended");
    }
    checkpointReturnAnchor = {
      checkpointId: identity.checkpointId,
      originalLeafId,
      branchEntryId,
    };
    pi.sendUserMessage(instructions);
    
    return { success: true, checkpointId: identity.checkpointId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    controller.failGuideCheckpoint(identity.checkpointId, errorMessage);
    inCheckpointBranch = false;
    checkpointOriginalLeafId = null;
    checkpointReturnAnchor = null;
    checkpointCtx = null;
    checkpointController = null;
    checkpointPendingId = null;
    checkpointCwd = null;
    checkpointPendingIdentity = null;
    return { 
      success: false, 
      checkpointId: identity.checkpointId,
      error: errorMessage
    };
  }
}

/**
 * Handle checkpoint exit command
 */
export async function handleCheckpointExit(options: CheckpointOptions): Promise<CheckpointResult> {
  const { pi, ctx } = options;
  

  // File order cannot identify the main branch after a tree fork. Use the
  // persisted anchor captured before the checkpoint child branch was created.
  const returnAnchor = checkpointReturnAnchor ?? findPendingCheckpointReturnAnchor(
    ctx.sessionManager.getEntries(),
    ctx.sessionManager.getLeafId(),
  );
  if (!returnAnchor) {
    return { success: false, error: "No checkpoint branch is waiting to be exited" };
  }

  
  try {
    if (ctx.sessionManager.getLeafId() !== returnAnchor.originalLeafId) {
      const result = await ctx.navigateTree(returnAnchor.originalLeafId, { summarize: false });
      if (result.cancelled) {
        return { success: false, error: "Tree navigation was cancelled" };
      }
    }
    if (ctx.sessionManager.getLeafId() !== returnAnchor.originalLeafId) {
      return { success: false, error: "Tree navigation did not reach the return anchor" };
    }
    pi.appendEntry(CHECKPOINT_RETURN_ENTRY_TYPE, buildCheckpointReturnMarker(returnAnchor));
    checkpointReturnAnchor = null;
    ctx.ui.notify("Returned to main branch", "info");
    return { success: true };
  } catch (error) {
    checkpointReturnAnchor = returnAnchor;
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Canonical guide

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type CheckpointCommandRunner = (
  command: string,
  args: string[],
  cwd: string,
  timeoutMs?: number,
) => Promise<CommandResult>;

export function buildCheckpointGuideArgs(identity: CheckpointIdentity): string[] {
  return [
    "sessions", "checkpoints", "guide",
    "--checkpoint-id", identity.checkpointId,
    "--session", identity.sessionId,
    "--agent", identity.agent,
    "--native-session", identity.nativeSessionId,
    "--entry-id", identity.entryId,
    "--anchor-leaf", identity.anchorLeafId,
    "--repo", identity.repoPath,
    "--format", "json",
  ];
}

export async function loadCheckpointGuide(
  identity: CheckpointIdentity,
  cwd: string,
  runner: CheckpointCommandRunner = runCommand,
): Promise<string> {
  const result = await runner("gsc", buildCheckpointGuideArgs(identity), cwd);
  if (!result.ok) {
    throw new Error(`Unable to load canonical checkpoint guide: ${result.stderr.trim() || "gsc command failed"}`);
  }
  let payload: any;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error("Unable to load canonical checkpoint guide: invalid JSON response");
  }
  const resolved = payload?.identity;
  if (payload?.schema_version !== 1 || typeof payload?.instructions !== "string" || !payload.instructions.trim()) {
    throw new Error("Unable to load canonical checkpoint guide: incomplete response");
  }
  if (resolved?.checkpoint_id !== identity.checkpointId ||
      resolved?.session_id !== identity.sessionId ||
      resolved?.agent !== identity.agent ||
      resolved?.native_session_id !== identity.nativeSessionId ||
      resolved?.entry_id !== identity.entryId ||
      resolved?.anchor_leaf_id !== identity.anchorLeafId) {
    throw new Error("Unable to load canonical checkpoint guide: resolved identity mismatch");
  }
  return payload.instructions;
}

// Verification

export function buildCheckpointVerifyArgs(identity: CheckpointIdentity): string[] {
  return [
    "sessions", "checkpoints", "verify", identity.checkpointId,
    "--session", identity.sessionId,
    "--agent", identity.agent,
    "--native-session", identity.nativeSessionId,
    "--entry-id", identity.entryId,
    "--anchor-leaf", identity.anchorLeafId,
    "--format", "json",
  ];
}

export async function verifyCheckpoint(
  identity: CheckpointIdentity,
  cwd: string,
  runner: CheckpointCommandRunner = runCommand,
): Promise<void> {
  const result = await runner("gsc", buildCheckpointVerifyArgs(identity), cwd);
  if (!result.ok) {
    throw new Error(`Checkpoint verification failed: ${result.stderr.trim() || "gsc command failed"}`);
  }
  let payload: any;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error("Checkpoint verification failed: invalid JSON response");
  }
  const record = payload?.checkpoint;
  if (payload?.schema_version !== 1 || payload?.status !== "verified" ||
      payload?.checkpoint_id !== identity.checkpointId || payload?.file_changes_audited !== true ||
      !record || record.checkpointId !== identity.checkpointId ||
      record.sessionId !== identity.sessionId || record.entryId !== identity.entryId ||
      record.source?.agent !== identity.agent ||
      record.source?.nativeSessionId !== identity.nativeSessionId ||
      record.source?.anchorLeafId !== identity.anchorLeafId ||
      !Array.isArray(record.file_changes)) {
    throw new Error("Checkpoint verification failed: persisted identity or file audit mismatch");
  }
}

function runCommand(command: string, args: string[], cwd: string, timeoutMs = 15_000): Promise<CommandResult> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], cwd });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ ok: exitCode === 0, stdout, stderr });
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: err.message });
    });
  });
}
