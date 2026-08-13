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
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PiBrainsController } from "./controller.ts";
import { debugLog, getLogFilePath } from "./debug-log.ts";

// State for tracking checkpoint branch
let inCheckpointBranch = false;
let checkpointOriginalLeafId: string | null = null;
let checkpointCtx: ExtensionCommandContext | null = null;
let checkpointController: PiBrainsController | null = null;
let checkpointPendingId: string | null = null;
let checkpointCwd: string | null = null;

/**
 * Initialize checkpoint event handlers
 */
export function initCheckpointHandlers(pi: ExtensionAPI): void {
  // Listen for agent_end to detect when checkpoint is done
  pi.on("agent_end", async (_event, ctx) => {
    if (inCheckpointBranch && checkpointOriginalLeafId && checkpointCtx && checkpointController && checkpointPendingId && checkpointCwd) {
      debugLog("Agent ended in checkpoint branch, verifying checkpoint");
      
      // Wait for agent to fully finish and UI to settle
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Hide the working indicator
      checkpointCtx.ui.setWorkingVisible(false);

      let verified = false;
      let verificationError = "";
      try {
        await verifyCheckpoint(checkpointPendingId, checkpointCwd);
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
  
  // Step 2: Create scratch branch and send instructions
  debugLog("Creating scratch branch");
  return await createCheckpointBranch(
    pi,
    ctx,
    controller,
    sessionId,
    sessionFile,
    leafId,
    cwd,
    checkpointId,
    {
      files: checkpointResult.trackedFiles,
      tools: checkpointResult.toolNames,
      rules: checkpointResult.ruleIds,
    },
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
  sessionId: string,
  sessionFile: string | null,
  leafId: string,
  cwd: string,
  checkpointId: string,
  tracked: { files: string[]; tools: string[]; rules: string[] },
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
    checkpointPendingId = checkpointId;
    checkpointCwd = cwd;
    
    // 3. Send checkpoint instructions as user message
    debugLog("Sending checkpoint instructions");
    const instructions = buildCheckpointInstructions(
      sessionId,
      leafId,
      checkpointId,
      cwd,
      tracked,
    );
    pi.sendUserMessage(instructions);
    debugLog("Checkpoint instructions sent");
    
    debugLog("Checkpoint branch created");
    return { success: true, checkpointId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    controller.failGuideCheckpoint(checkpointId, errorMessage);
    inCheckpointBranch = false;
    checkpointOriginalLeafId = null;
    checkpointCtx = null;
    checkpointController = null;
    checkpointPendingId = null;
    checkpointCwd = null;
    debugLog("Error creating checkpoint branch", { error: errorMessage });
    return { 
      success: false, 
      checkpointId,
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

// Instructions

/**
 * Build the agent-executed workflow. Pi supplies identity and provenance;
 * the agent supplies only conversation-supported work-state content.
 */
export function buildCheckpointInstructions(
  sessionId: string,
  leafId: string,
  checkpointId: string,
  repoPath: string,
  tracked: { files: string[]; tools: string[]; rules: string[] } = { files: [], tools: [], rules: [] },
): string {
  const trackedFiles = repoRelativeTrackedFiles(tracked.files, repoPath);
  return `Create a checkpoint for this session.

IMPORTANT RULES:
- Only include facts, decisions, risks, and evidence supported by the provided context.
- Do not invent file purposes, decisions, tests, risks, or next steps.
- If something is unknown, omit it or use an empty array.
- If a previous checkpoint exists, carry forward any decisions, risks, or open questions that still matter. Do not include resolved items unless they remain relevant.
- Do not leave placeholder values. For optional array fields, use [] when there are no supported items. For optional string fields, omit the field or use "" only if the schema requires it.
- Optimize the checkpoint for future discovery. In goal, summary, current_understanding, and topics, use concrete feature names, component names, domain terms, and user-visible concepts that another agent is likely to search for later. Avoid generic phrases such as "fix issue", "continue implementation", or "miscellaneous changes".

You are creating a checkpoint for this session. Follow ALL steps in order.

STEP 0: Review previous checkpoints
Run: gsc sessions checkpoints list --session ${sessionId} --branch ${leafId}
If checkpoints exist:
- Read them in order (oldest to newest)
- Note what was already decided
- Note what risks were identified
- Note what open questions remain
- Note what the current understanding was
Carry forward any decisions, risks, or open questions that still matter.
Do not include resolved items unless they remain relevant.
If no checkpoints exist, proceed without review.

STEP 1: Write checkpoint JSON
Write the complete checkpoint JSON to /tmp/checkpoint-${checkpointId}.json based on the conversation.
Do NOT use the template command - write the JSON directly from scratch.
This avoids unicode escape issues and makes the file easier to edit if needed.

The JSON must include ALL of these fields:

METADATA FIELDS (use these exact values):
- type: "checkpoint_recorded"
- schemaVersion: 1
- checkpointId: "${checkpointId}"
- sessionId: "${sessionId}"
- entryId: "${leafId}"
- source: {"agent": "pi", "nativeSessionId": "${sessionId}", "anchorLeafId": "${leafId}"}
- scope: "personal"
- createdAt: <current ISO timestamp>
- privacy: {"containsTranscript": false, "containsRawToolOutput": false, "safeToCommit": false}
- files: ${JSON.stringify(trackedFiles)}
- tools: ${JSON.stringify(tracked.tools)}
- rules: ${JSON.stringify(tracked.rules)}

Do not add workspace_repository. The gsc append command derives and overwrites repository metadata from --repo.
The files, tools, and rules above come from Pi Brains tracking. Preserve them exactly; do not infer replacements. Empty arrays are valid.

REQUIRED AI-GENERATED FIELDS:

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
  Example: ["Store entryId for branch-aware filtering", "Keep repository metadata derived by gsc"]

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

STEP 2: Validate checkpoint
Run: gsc sessions checkpoints validate --from-file /tmp/checkpoint-${checkpointId}.json
If validation fails, fix the errors and re-validate (up to 2 attempts).

STEP 3: Append checkpoint
Run: gsc sessions checkpoints append --from-file /tmp/checkpoint-${checkpointId}.json --repo ${shellQuote(repoPath)} --target personal

STEP 4: Verify checkpoint
Run: gsc sessions checkpoints list --session ${sessionId} --branch ${leafId}
Confirm the checkpoint appears in the list.
Run: gsc sessions checkpoints show ${checkpointId}
Confirm the checkpoint can be shown.

STEP 5: Report result
Report the checkpoint ID and confirmation that all verification steps passed.`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function repoRelativeTrackedFiles(files: string[], repoPath: string): string[] {
  const repoRoot = resolve(repoPath);
  const normalized = files.flatMap(file => {
    const absolute = isAbsolute(file) ? resolve(file) : resolve(repoRoot, file);
    const repoRelative = relative(repoRoot, absolute);
    if (repoRelative === "" || repoRelative === ".." || repoRelative.startsWith(`..${sep}`) || isAbsolute(repoRelative)) {
      return [];
    }
    return [repoRelative.split(sep).join("/")];
  });
  return [...new Set(normalized)];
}

// Verification

/**
 * Verify checkpoint exists
 */
async function verifyCheckpoint(checkpointId: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Omit --repo because the checkpoint is personal; running from cwd still
    // gives gsc repository context while allowing its normal all-scope lookup.
    const proc = spawn("gsc", ["sessions", "checkpoints", "show", checkpointId], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd,
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
