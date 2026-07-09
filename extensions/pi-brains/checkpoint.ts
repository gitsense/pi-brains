/**
 * Checkpoint Handler
 * 
 * Handles the /brains checkpoint command.
 * Creates a checkpoint by:
 * 1. Showing confirmation UI
 * 2. Building context packet (orchestrator)
 * 3. Creating template (orchestrator)
 * 4. Calling complete() to fill AI-generated fields (agent)
 * 5. Validating checkpoint (orchestrator)
 * 6. Appending checkpoint (orchestrator)
 * 7. Verifying checkpoint (orchestrator)
 * 8. Navigating back to main branch
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import type { PiBrainsController } from "./controller.ts";
import { CheckpointLog } from "./checkpoint-log.ts";
import { debugLog, getLogFilePath } from "./debug-log.ts";
import { matchesKey } from "@earendil-works/pi-tui";

// State for tracking checkpoint branch
let inCheckpointBranch = false;
let checkpointOriginalLeafId: string | null = null;
let checkpointCtx: ExtensionCommandContext | null = null;

/**
 * Initialize checkpoint event handlers
 */
export function initCheckpointHandlers(pi: ExtensionAPI): void {
  // Listen for agent_end to detect when checkpoint is done
  pi.on("agent_end", async (_event, ctx) => {
    if (inCheckpointBranch && checkpointOriginalLeafId && checkpointCtx) {
      debugLog("Agent ended in checkpoint branch, showing return UI");
      
      // Wait for agent to fully finish and UI to settle
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Hide the working indicator
      checkpointCtx.ui.setWorkingVisible(false);
      
      // Show selection dialog
      const choice = await checkpointCtx.ui.select(
        "Checkpoint Created",
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

// Main handler

/**
 * Handle /brains checkpoint command
 */
export async function handleCheckpoint(options: CheckpointOptions): Promise<CheckpointResult> {
  const { pi, ctx, controller, sessionId, sessionFile, leafId, cwd } = options;
  
  debugLog("handleCheckpoint started", { sessionId, sessionFile: sessionFile?.slice(-50), leafId, cwd });
  
  // Initialize logging
  const log = new CheckpointLog();
  if (sessionFile) {
    log.setSession(sessionFile, sessionId, leafId);
  }
  
  // Get checkpoint ID from controller (handles logging)
  debugLog("Requesting checkpoint ID from controller");
  const checkpointResult = controller.requestGuideCheckpoint("manual");
  const checkpointId = checkpointResult.checkpointId;
  debugLog("Got checkpoint ID", { checkpointId });
  
  // Step 1: Show confirmation UI
  debugLog("Showing confirmation UI");
  const logPath = getLogFilePath();
  const confirmed = await ctx.ui.confirm(
    "Create Checkpoint",
    `Create checkpoint for session ${sessionId.slice(0, 12)}...?\n\nCheckpoint ID: ${checkpointId}\nDebug log: ${logPath}`
  );
  
  if (!confirmed) {
    debugLog("User cancelled");
    return { success: false, error: "cancelled" };
  }
  
  debugLog("User confirmed");
  
  // Validate leafId
  if (!leafId) {
    debugLog("No leaf ID available");
    return { success: false, error: "No leaf ID available" };
  }
  
  // Step 2: Create scratch branch and send instructions
  debugLog("Creating scratch branch");
  return await createCheckpointBranch(pi, ctx, controller, sessionId, sessionFile, leafId, cwd, checkpointId, log);
}

// UI

/**
 * Show BorderedLoader with confirmation
 */
async function showConfirmation(
  ctx: ExtensionCommandContext,
  sessionId: string,
  checkpointId: string
): Promise<boolean> {
  const logPath = getLogFilePath();
  debugLog("showConfirmation started", { sessionId, checkpointId, logPath });
  
  // Use BorderedLoader for confirmation
  return await ctx.ui.custom<boolean>((tui, theme, _kb, done) => {
    const loader = new BorderedLoader(tui, theme, "Create checkpoint?");
    loader.onAbort = () => {
      debugLog("User pressed Esc");
      done(false);
    };
    
    // Handle Enter to confirm
    const originalHandleInput = loader.handleInput.bind(loader);
    loader.handleInput = (data: string) => {
      if (data === "\r" || data === "\n") {
        debugLog("User pressed Enter");
        done(true);
      } else {
        originalHandleInput(data);
      }
    };
    
    return loader;
  });
}

// Execution

/**
 * Create scratch branch and send checkpoint instructions
 */
async function createCheckpointBranch(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  controller: PiBrainsController,
  sessionId: string,
  sessionFile: string | null,
  leafId: string,
  cwd: string,
  checkpointId: string,
  log: CheckpointLog
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
    
    // 3. Send checkpoint instructions as user message
    debugLog("Sending checkpoint instructions");
    const instructions = buildCheckpointInstructions(sessionId, leafId, checkpointId, cwd);
    pi.sendUserMessage(instructions);
    debugLog("Checkpoint instructions sent");
    
    debugLog("Checkpoint branch created");
    return { success: true, checkpointId };
  } catch (error) {
    debugLog("Error creating checkpoint branch", { error: error instanceof Error ? error.message : String(error) });
    return { 
      success: false, 
      checkpointId,
      error: error instanceof Error ? error.message : String(error)
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

// Subprocess

/**
 * Run pi -p subprocess with checkpoint instructions
 */
async function runPiSubprocess(
  sessionFile: string | null,
  prompt: string,
  cwd: string,
  onSubprocess?: (proc: import("node:child_process").ChildProcess) => void
): Promise<boolean> {
  if (!sessionFile) {
    debugLog("No session file for subprocess");
    return false;
  }
  
  debugLog("Spawning pi -p subprocess", { sessionFile: sessionFile.slice(-50), prompt, cwd });
  
  return new Promise((resolve) => {
    const proc = spawn("pi", ["-p", "--session", sessionFile, prompt], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: cwd,
    });
    
    // Store subprocess reference for cancellation
    onSubprocess?.(proc);
    
    proc.on("close", (exitCode) => {
      debugLog("Subprocess closed", { exitCode });
      resolve(exitCode === 0);
    });
    
    proc.on("error", (err) => {
      debugLog("Subprocess error", { error: err.message });
      resolve(false);
    });
  });
}

// Instructions

/**
 * Build checkpoint instructions for the agent
 * 
 * This is the orchestrator layer - it handles:
 * 1. Building context packet
 * 2. Loading previous visible checkpoint
 * 3. Creating template
 * 4. Calling complete() to fill AI-generated fields
 * 5. Validating checkpoint
 * 6. Appending checkpoint
 * 7. Verifying checkpoint
 */
function buildCheckpointInstructions(
  sessionId: string,
  leafId: string,
  checkpointId: string,
  repoPath: string
): string {
  // Get repo ID from git remote
  const repoId = "gitsense/pi"; // TODO: Get from git remote
  
  return `Create a checkpoint for this session.

IMPORTANT RULES:
- Only include facts, decisions, risks, and evidence supported by the provided context.
- Do not invent file purposes, decisions, tests, risks, or next steps.
- If something is unknown, omit it or use an empty array.
- If a previous checkpoint exists, carry forward any decisions, risks, or open questions that still matter. Do not include resolved items unless they remain relevant.
- Do not leave placeholder values. For optional array fields, use [] when there are no supported items. For optional string fields, omit the field or use "" only if the schema requires it.

You are creating a checkpoint for this session. Follow ALL steps in order.

STEP 1: Create template file
Run: gsc sessions checkpoints template --session ${sessionId} --agent pi --entry-id ${leafId} --workspace-repo-id "${repoId}" --workspace-repo-source "git_remote_origin" --scope personal --out /tmp/checkpoint-${checkpointId}.json

STEP 2: Fill AI-generated fields
Edit /tmp/checkpoint-${checkpointId}.json and replace placeholder values with actual content based on the conversation.

REQUIRED FIELDS:

- goal: The broader objective of the work (max 240 chars)
  Example: "Update checkpoint schema to v1 with branch-aware filtering"

- current_understanding: What you currently believe is true about the work state (max 1200 chars)
  Example: "The checkpoint schema needs to support branch-aware filtering so that checkpoints created on scratch branches are not visible on the main branch."

- next_action: The immediate next concrete step (max 240 chars)
  Example: "Test the new schema with a real checkpoint creation"

OPTIONAL FIELDS (omit if not applicable):

- current_task: The active subtask right now (max 240 chars)
  Example: "Updating gsc-cli to support the new checkpoint schema"

- topics: List of topics with states (max 7 items)
  STRONGLY RECOMMENDED: Include 1-5 topics if the context provides enough information. Use at most one primary topic.
  Use short kebab-case topic names. Topics power search, clustering, drift detection, checkpoint navigation, and session overview.
  Example: [{"name": "checkpoint-schema", "state": "primary"}, {"name": "branch-aware-filtering", "state": "supporting"}]

- decisions: Key decisions made (0-8 items)
  Example: ["Use workspace_repository instead of repo", "Store entryId for branch-aware filtering"]

- evidence: Observable facts from context (0-10 items)
  STRONGLY RECOMMENDED: If current_understanding is non-empty, try to include at least one evidence item.
  Evidence should be observable: user decisions, schema contents, validation results, file traces, command results, or explicit prior checkpoint content.
  A checkpoint without evidence is still a summary. A checkpoint with evidence becomes reviewable.
  Example: ["Current schema v1 has 6 fields", "Proposed hybrid schema has 11 fields"]

- risks: Risks or uncertainties identified (0-7 items)
  Example: ["Agent might not fill in all fields correctly"]

- open_questions: Questions remaining (0-7 items)
  Example: ["How to handle backward compatibility with v1 checkpoints?"]

- summary: Short human-readable one-line recap (max 300 chars)
  Example: "Updated checkpoint schema to v1 with branch-aware filtering support"

- health: Self-assessed health at checkpoint time (optional)
  Health describes the state at checkpoint creation time. It is not a live status after more messages, tool calls, or file changes occur.
  - status: focused | exploring | validating | blocked | drifting | unknown
    - focused: Work is centered on a single task or goal
    - exploring: Investigating multiple options or directions
    - validating: Testing or verifying something
    - blocked: Unable to make progress
    - drifting: Work has moved away from the original goal
    - unknown: Unable to determine
  - focus: high | medium | low | unknown
    - high: Most recent work is directly related to the goal
    - medium: Some work is related, some is tangential
    - low: Most work is tangential or exploratory
    - unknown: Unable to determine
  - reason: Why you chose this status and focus (max 300 chars)
  Example: {"status": "focused", "focus": "high", "reason": "Recent work remains centered on checkpoint schema"}

STEP 3: Validate checkpoint
Run: gsc sessions checkpoints validate --from-file /tmp/checkpoint-${checkpointId}.json
If validation fails, fix the errors and re-validate (up to 2 attempts).

STEP 4: Append checkpoint
Run: gsc sessions checkpoints append --from-file /tmp/checkpoint-${checkpointId}.json --repo ${repoPath} --target personal

STEP 5: Verify checkpoint
Run: gsc sessions checkpoints list --session ${sessionId}
Confirm the checkpoint appears in the list.
Run: gsc sessions checkpoints show ${checkpointId}
Confirm the checkpoint can be shown.

STEP 6: Report result
Report the checkpoint ID and confirmation that all verification steps passed.`;
}

// Verification

/**
 * Verify checkpoint exists
 */
async function verifyCheckpoint(checkpointId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("gsc", ["sessions", "checkpoints", "show", checkpointId], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    
    let output = "";
    proc.stdout.on("data", (data) => {
      output += data.toString();
    });
    
    proc.on("close", (exitCode) => {
      if (exitCode === 0 && !output.includes("not found")) {
        resolve();
      } else {
        reject(new Error("Checkpoint not found after creation"));
      }
    });
    
    proc.on("error", (err) => {
      reject(err);
    });
  });
}
