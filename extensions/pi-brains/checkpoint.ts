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

  // Resolve the git baseline used by STEP 1 and the post-append audit:
  // previous checkpoint head (if any) takes precedence over the session-start
  // head, so the two stay consistent within a multi-checkpoint session.
  const baselineHead = (await resolvePreviousCheckpointHead(sessionId, leafId, cwd))
    ?? checkpointResult.sessionStartHead;
  debugLog("Resolved checkpoint baseline", { baselineHead, sessionStartBranch: checkpointResult.sessionStartBranch });
  
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
      baselineHead,
      sessionStartBranch: checkpointResult.sessionStartBranch,
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
  tracked: { files: string[]; tools: string[]; rules: string[]; baselineHead: string | null; sessionStartBranch: string | null },
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
  tracked: { files: string[]; tools: string[]; rules: string[]; baselineHead: string | null; sessionStartBranch: string | null } = { files: [], tools: [], rules: [], baselineHead: null, sessionStartBranch: null },
): string {
  const trackedFiles = repoRelativeTrackedFiles(tracked.files, repoPath);
  const baselineHead = tracked.baselineHead ?? null;
  const sessionStartBranch = tracked.sessionStartBranch ?? null;
  const gitReconcileStep = baselineHead
    ? `   - If the baseline head is known (${baselineHead}), run: git diff --name-only ${baselineHead}\n   - If you switched branches this session (you started on ${sessionStartBranch ?? "an unknown branch"}) or no baseline applies, run: git status --porcelain --untracked-files=all`
    : `   - Run: git status --porcelain --untracked-files=all`;
  return `Create a checkpoint for this session.

IMPORTANT RULES:
- Only include facts, decisions, risks, and evidence supported by the provided context.
- Do not invent file purposes, decisions, tests, risks, or next steps.
- If something is unknown, omit it or use an empty array.
- If a previous checkpoint exists, carry forward any decisions, risks, or open questions that still matter. Do not include resolved items unless they remain relevant.
- Do not leave placeholder values. For optional array fields, use [] when there are no supported items. For optional string fields, omit the field or use "" only if the schema requires it.
- Optimize the checkpoint for future discovery. In goal, summary, current_understanding, and topics, use concrete feature names, component names, domain terms, and user-visible concepts that another agent is likely to search for later. Avoid generic phrases such as "fix issue", "continue implementation", or "miscellaneous changes".
- Keep current_understanding as a concise synthesis of the current mental model, not a chronology. Aim for 1200 characters or fewer; 2000 characters is the hard maximum. Move enumerated facts and history into evidence, decisions, risks, and open_questions.

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

STEP 1: Audit ALL file changes
Every file changed by THIS session must be recorded in file_changes. The conversation is the only reliable source of what you did; git output is only a completeness aid. The working tree may contain changes made by OTHER agents, the user, or earlier work — never record a file just because git lists it. Include a file only when this conversation evidences you changed it.
Build the authoritative change list:
1. Start from the tracked baseline in files (above) — these came from read/edit/write tool calls and are unambiguously yours. Keep them with method "edit" or "write" ("read" is not a change; do not include read-only files).
2. Review the bash commands below (and any others in this conversation) for file-modifying operations: git apply, git am, patch, sed -i, perl -i, perl -e, awk, tee, redirections (> and >>), heredocs (cat > file <<EOF), touch, mv, cp, rm, git rm, and any other command that created, modified, moved, or deleted a file. For each, add the concrete target path with method "bash". Use the exact path visible in the command text or tool output; never guess or invent a path.
3. Reconcile with git as a completeness check — it CANNOT distinguish your changes from others', so adjudicate every candidate against the conversation:
${gitReconcileStep}
   git diff --name-only also surfaces files committed mid-session. For each listed file, include it in file_changes ONLY if the conversation evidences you changed it. Ignore files changed by other agents or the user, and pre-existing changes.
4. Identify the repository for every file outside the workspace repo (from its absolute path or cd/pwd output) and add a matching entry to the repositories legend.

STEP 2: Write checkpoint JSON
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
- file_changes: <authoritative array of every file changed in this session> (see rules below)
- repositories: <legend resolving every file_changes[].repository id> (see rules below)
- tools: ${JSON.stringify(tracked.tools)}
- rules: ${JSON.stringify(tracked.rules)}

Do not add workspace_repository. The gsc append command derives and overwrites repository metadata from --repo.
The tools and rules above come from Pi Brains tracking; preserve them exactly. Empty arrays are valid.
The files value above is only the tool-tracked baseline (read/edit/write calls). Bash-driven changes are NOT tracked automatically, which is why STEP 1 audits every change. file_changes is the authoritative list, and gsc derives the stored files field from its workspace-repository entries.

file_changes rules:
- Each entry: {"path": "...", "repository": "...", "method": "...", "change": "..."}
- path: relative to the file's own repository root; never absolute; no "..".
- repository: OMIT for files in the workspace repo (the repo --repo points at). For files in OTHER repositories, set the repository id — it MUST match an id in the repositories legend below. This is how checkpoints record changes across multiple repositories.
- method: "edit" (edit tool), "write" (write tool), "bash" (changed via a shell command), or "unknown".
- change: "modified" (default), "created", "deleted", or "moved". For "moved", record the destination path and add a separate entry for the source with change "deleted".
- REQUIRED: include EVERY file changed this session — via tools OR bash (STEP 1). Do not omit a file just because it was not a read/edit/write call.
- Only include paths with direct evidence in the conversation. Never guess.
- Example entry: {"path": "internal/sessions/models.go", "repository": "gsc-cli", "method": "bash", "change": "modified"}

repositories legend rules:
- Each entry: {"id": "...", "root": "...", "remote"?: "...", "branch"?: "...", "head"?: "..."}
- id: a short stable repository id (the git root basename, e.g. "gsc-cli", "pi-brains").
- root: the machine-local absolute checkout path (e.g. "/Users/you/gsc-cli"). This is how consumers resolve file paths as root + "/" + path.
- REQUIRED: every repository id referenced by file_changes must appear here. Include one entry per repository touched outside the workspace repo.
- You MAY include the workspace repo too, but you may omit it — gsc appends it with its root automatically.
- Derive roots from absolute paths or cd/pwd output visible in the conversation; never invent a root.
- Example: [{"id": "gsc-cli", "root": "/Users/you/gsc-cli"}, {"id": "pi-brains", "root": "/Users/you/pi-brains"}]

REQUIRED AI-GENERATED FIELDS:

- goal: The broader objective of the work (max 240 chars)
  Example: "Update checkpoint schema to v1 with branch-aware filtering"

- current_understanding: What you currently believe is true about the work state (target: max 1200 chars; hard maximum: 2000 chars)
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

STEP 3: Validate checkpoint
Before validation, confirm that current_understanding is no more than 2000 characters and preferably no more than 1200. For example:
Run: jq -r '.current_understanding | length' /tmp/checkpoint-${checkpointId}.json
Run: gsc sessions checkpoints validate --from-file /tmp/checkpoint-${checkpointId}.json
If validation fails, fix the errors and re-validate (up to 2 attempts).

STEP 4: Append checkpoint
Run: gsc sessions checkpoints append --from-file /tmp/checkpoint-${checkpointId}.json --repo ${shellQuote(repoPath)} --target personal

STEP 5: Verify checkpoint
Run: gsc sessions checkpoints list --session ${sessionId} --branch ${leafId}
Confirm the checkpoint appears in the list.
Run: gsc sessions checkpoints show ${checkpointId}
Confirm the checkpoint can be shown and that its file_changes match your audit (files not listed may have been missed).

STEP 6: Report result
Report the checkpoint ID, the file change count, and confirmation that all verification steps passed.`;
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

// Command runner

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
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

/**
 * Resolve the previous checkpoint's workspace head for a session/branch, used
 * as the git baseline for file-change reconciliation. The current checkpoint
 * does not exist yet when this runs, so the latest record is the previous one.
 */
async function resolvePreviousCheckpointHead(sessionId: string, leafId: string, cwd: string): Promise<string | null> {
  try {
    const result = await runCommand(
      "gsc",
      ["sessions", "checkpoints", "list", "--session", sessionId, "--branch", leafId, "--format", "json"],
      cwd,
    );
    if (!result.ok) return null;
    let records: Array<{ createdAt?: string; workspace_repository?: { head?: string } }>;
    try {
      records = JSON.parse(result.stdout);
    } catch {
      return null;
    }
    let latestHead: string | null = null;
    let latestCreatedAt = "";
    for (const record of records) {
      const head = record.workspace_repository?.head;
      if (!head) continue;
      if (!latestHead || (record.createdAt ?? "") >= latestCreatedAt) {
        latestHead = head;
        latestCreatedAt = record.createdAt ?? "";
      }
    }
    return latestHead;
  } catch {
    return null;
  }
}
