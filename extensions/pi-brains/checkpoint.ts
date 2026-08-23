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

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import type { PiBrainsController } from "./controller.ts";
import { debugLog, getLogFilePath } from "./debug-log.ts";

// State for tracking checkpoint branch
let inCheckpointBranch = false;
let checkpointOriginalLeafId: string | null = null;
let checkpointCtx: ExtensionCommandContext | null = null;
let checkpointController: PiBrainsController | null = null;
let checkpointPendingId: string | null = null;
let checkpointCwd: string | null = null;
let checkpointPendingIdentity: CheckpointIdentity | null = null;

/**
 * Initialize checkpoint event handlers
 */
export function initCheckpointHandlers(pi: ExtensionAPI): void {
  // Listen for agent_end to detect when checkpoint is done
  pi.on("agent_end", async (_event, ctx) => {
    if (inCheckpointBranch && checkpointOriginalLeafId && checkpointCtx && checkpointController && checkpointPendingId && checkpointCwd && checkpointPendingIdentity) {
      debugLog("Agent ended in checkpoint branch, verifying checkpoint");
      
      // Wait for agent to fully finish and UI to settle
      await new Promise(resolve => setTimeout(resolve, 500));
      
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
      
      // Show selection dialog
      const choice = await checkpointCtx.ui.select(
        verified ? "Checkpoint Created" : "Checkpoint Failed",
        [
          "Return to main branch",
          "Stay on checkpoint branch"
        ]
      );
      
      if (choice === "Return to main branch") {
        debugLog("User chose to return to main branch");
        
        // Navigate back to main branch
        try {
          await checkpointCtx.navigateTree(checkpointOriginalLeafId, { summarize: false });
          debugLog("Navigated back to main branch");
          checkpointCtx.ui.notify("Returned to main branch", "info");
        } catch (error) {
          debugLog("Error navigating back", { error: error instanceof Error ? error.message : String(error) });
        }
      } else {
        debugLog("User chose to stay on checkpoint branch");
        checkpointCtx.ui.notify("Stay on checkpoint branch. Run '/brains checkpoint exit' to return later.", "info");
      }
      
      // Reset state
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

// Main handler

/**
 * Handle /brains checkpoint command
 */
export async function handleCheckpoint(options: CheckpointOptions): Promise<CheckpointResult> {
  const { pi, ctx, controller, sessionId, sessionFile, leafId, cwd } = options;
  
  debugLog("handleCheckpoint started", { sessionId, sessionFile: sessionFile?.slice(-50), leafId, cwd });
  
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
  debugLog("Showing confirmation UI");
  const logPath = getLogFilePath();
  const confirmed = await ctx.ui.confirm(
    "Create Checkpoint",
    `Create checkpoint for session ${sessionId.slice(0, 12)}...?\n\nDebug log: ${logPath}`
  );
  
  if (!confirmed) {
    debugLog("User cancelled");
    return { success: false, error: "cancelled" };
  }
  
  debugLog("User confirmed");
  
  debugLog("Requesting checkpoint ID from controller");
  const checkpointResult = controller.requestGuideCheckpoint("manual");
  const checkpointId = checkpointResult.checkpointId;
  debugLog("Got checkpoint ID", { checkpointId });

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
  debugLog("Creating scratch branch");
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
  
  try {
    // 1. Navigate to scratch branch (navigate to last assistant message)
    debugLog("Creating scratch branch");
    debugLog("Navigating to scratch branch", { leafId, originalLeafId });
    
    // Navigate to the last assistant message to create scratch branch
    await ctx.navigateTree(originalLeafId, { summarize: false });
    debugLog("Navigated to last assistant message", { originalLeafId });
    
    // 2. Set state for tracking checkpoint branch
    inCheckpointBranch = true;
    checkpointOriginalLeafId = originalLeafId;
    checkpointCtx = ctx;
    checkpointController = controller;
    checkpointPendingId = identity.checkpointId;
    checkpointCwd = cwd;
    checkpointPendingIdentity = identity;
    
    // 3. Send checkpoint instructions as user message
    debugLog("Sending checkpoint instructions");
    pi.sendUserMessage(instructions);
    debugLog("Checkpoint instructions sent");
    
    debugLog("Checkpoint branch created");
    return { success: true, checkpointId: identity.checkpointId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    controller.failGuideCheckpoint(identity.checkpointId, errorMessage);
    inCheckpointBranch = false;
    checkpointOriginalLeafId = null;
    checkpointCtx = null;
    checkpointController = null;
    checkpointPendingId = null;
    checkpointCwd = null;
    checkpointPendingIdentity = null;
    debugLog("Error creating checkpoint branch", { error: errorMessage });
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
  const { ctx } = options;
  
  debugLog("handleCheckpointExit started");
  
  // Find the main branch leaf
  // We need to find the leaf that was active before we created the scratch branch
  // For now, we'll just navigate to the latest leaf
  const entries = ctx.sessionManager.getEntries();
  if (entries.length === 0) {
    debugLog("No entries found");
    return { success: false, error: "No entries found" };
  }
  
  // Find the main branch leaf (the one that's not in the scratch branch)
  // For simplicity, navigate to the last entry
  const lastEntry = entries[entries.length - 1];
  debugLog("Navigating to main branch", { leafId: lastEntry.id });
  
  try {
    await ctx.navigateTree(lastEntry.id, { summarize: false });
    debugLog("Navigated to main branch");
    ctx.ui.notify("Returned to main branch", "info");
    return { success: true };
  } catch (error) {
    debugLog("Error navigating to main branch", { error: error instanceof Error ? error.message : String(error) });
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
