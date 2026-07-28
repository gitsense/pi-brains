import { copyToClipboard, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { getChatAppStatus, openExternalUrl } from "./chat-app.ts";
import { loadConfig } from "./config.ts";
import { PiBrainsController, type GuideCheckpointRequestResult } from "./controller.ts";
import { handleCheckpoint, handleCheckpointExit, initCheckpointHandlers } from "./checkpoint.ts";
import { debugLog } from "./debug-log.ts";
import { buildInspectDialog } from "./inspect-view.ts";
import { handleRecorderRulesCommand, handleShellRulesCommand } from "./rule-catalog.ts";
import { isSuccessfulExpertsInit, showBrainsStatus } from "./brains-status.ts";
import { handleInboxCommand, startInboxWatcher } from "./inbox.ts";

export default async function piBrains(pi: ExtensionAPI): Promise<void> {
  const config = await loadConfig();
  const controller = new PiBrainsController(pi, config);
  let brainsStatusPending = false;
  let stopInboxWatcher: (() => void) | null = null;

  // Initialize checkpoint event handlers
  initCheckpointHandlers(pi);

  // Initialize post-compact event handlers
  initPostCompactHandlers(pi);

  // Register message renderer for context injection (agent-visible)
  pi.registerMessageRenderer("brains-context", (message, _options, theme) => {
    const content = typeof message.content === "string" ? message.content : "";
    const prefix = theme.fg("accent", "[brains-context]");
    return new Text(prefix + "\n\n" + content, 0, 0);
  });

  pi.on("session_start", (_event, ctx) => {
    brainsStatusPending = false;
    controller.start(ctx);
    stopInboxWatcher?.();
    stopInboxWatcher = startInboxWatcher(controller, ctx);
  });

  pi.on("input", (event, ctx) => {
    return controller.handleInput(event, ctx);
  });

  pi.on("before_agent_start", (event, ctx) => {
    return controller.handleBeforeAgentStart(event, ctx);
  });

  pi.on("agent_start", (event, ctx) => {
    return controller.handleAgentStart(event, ctx);
  });

  pi.on("context", (event, ctx) => {
    return controller.handleContext(event, ctx);
  });

  pi.on("session_before_compact", (event, ctx) => {
    return controller.handleSessionBeforeCompact(event, ctx);
  });

  pi.on("session_compact", (event, ctx) => {
    return controller.handleSessionCompact(event, ctx);
  });

  pi.on("tool_call", (event, ctx) => {
    return controller.handleToolCall(event, ctx);
  });

  pi.on("tool_result", (event, ctx) => {
    controller.recordToolResult(event, ctx);
    if (isSuccessfulExpertsInit(event)) {
      brainsStatusPending = true;
    }
    return controller.handleToolResult(event, ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    controller.refreshSessionState(ctx);
  });

  pi.on("thinking_level_select", (_event, ctx) => {
    controller.refreshSessionState(ctx);
  });

  pi.on("message_end", async (event, ctx) => {
    controller.refreshSessionState(ctx);

    return undefined;
  });

  pi.on("session_compact", (_event, ctx) => {
    controller.refreshSessionState(ctx);
  });

  pi.on("agent_end", async (event, ctx) => {
    const result = await controller.handleStop(event, ctx);
    if (brainsStatusPending) {
      brainsStatusPending = false;
      await showBrainsStatus(controller, ctx as unknown as ExtensionCommandContext);
    }
    return result;
  });

  pi.on("session_shutdown", () => {
    stopInboxWatcher?.();
    stopInboxWatcher = null;
    controller.dispose();
  });

  pi.registerCommand("brains", {
    description: "Manage pi-brains and rules",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const command = parts[0];
      const value = parts.slice(1).join(" ");

      // /brains - show initialization and help options
      if (!command) {
        await initializeBrains(controller, ctx as unknown as ExtensionContext);
        return;
      }

      // /brains insights - show the current inspect state as a notification
      if (command === "insights") {
        const output = controller.renderInsightsSnapshot();
        ctx.ui.notify(output || "No insights available", "info");
        return;
      }

      // /brains status - show the current GitSense configuration
      if (command === "status") {
        await showBrainsStatus(controller, ctx as unknown as ExtensionCommandContext);
        return;
      }

      // /brains build - build/import a Brain manifest
      if (command === "build") {
        await handleBuildCommand(value, controller, ctx as unknown as ExtensionCommandContext);
        return;
      }

      // /brains rules - show rules status
      if (command === "rules") {
        await handleRulesCommand(value, controller, ctx as unknown as ExtensionCommandContext);
        return;
      }

      // /brains inspect - open/close inspect view
      if (command === "inspect") {
        await handleInspectCommand(value, controller, ctx);
        return;
      }

      // /brains inbox - review messages drafted in GitSense Chat
      if (command === "inbox") {
        await handleInboxCommand(controller, ctx, value);
        return;
      }

      // /brains about - what GitSense can do
      if (command === "about") {
        showAbout(ctx as unknown as ExtensionCommandContext);
        return;
      }

      // /brains help - show available commands
      if (command === "help") {
        showHelp(ctx as unknown as ExtensionCommandContext);
        return;
      }

      // Legacy commands
      if (command === "dismiss") {
        await controller.dismissNotice();
        ctx.ui.notify("pi-brains notice dismissed", "info");
        return;
      }

      if (command === "debug") {
        if (value === "on") {
          controller.setDebug(true);
          const logPath = controller.getDebugLogFilePath();
          ctx.ui.notify(`Debug enabled. Log file: ${logPath}`, "info");
          return;
        }
        if (value === "off") {
          controller.setDebug(false);
          ctx.ui.notify("Debug disabled", "info");
          return;
        }
        if (value === "file") {
          const logPath = controller.getDebugLogFilePath();
          ctx.ui.notify(`Debug log: ${logPath}`, "info");
          return;
        }
        // Toggle debug mode
        const newDebugState = !controller.isDebug();
        controller.setDebug(newDebugState);
        if (newDebugState) {
          const logPath = controller.getDebugLogFilePath();
          ctx.ui.notify(`Debug enabled. Log file: ${logPath}`, "info");
        } else {
          ctx.ui.notify("Debug disabled", "info");
        }
        return;
      }

      // /brains checkpoint - create checkpoint
      if (command === "checkpoint") {
        handleCheckpointCommand(value, pi, controller, ctx as unknown as ExtensionContext);
        return;
      }

      // /brains show-compact-messages (scm) - show compacted messages
      if (command === "show-compact-messages" || command === "scm") {
        await handleShowCompactMessages(controller, ctx as unknown as ExtensionCommandContext);
        return;
      }

      // /brains post-compact (pc) - enrich compaction with checkpoint + brain metadata
      if (command === "post-compact" || command === "pc") {
        await handlePostCompact(pi, controller, ctx as unknown as ExtensionCommandContext);
        return;
      }

      if (command === "gsc") {
        const output = await controller.runGscBrains();
        console.log(output);
        return;
      }

      if (command === "code-intent" && value === "purpose") {
        const results = await controller.queryBrainForFiles("code-intent", "purpose");
        if (results.size === 0) {
          ctx.ui.notify("No brain data available for tracked files", "warning");
          return;
        }
        console.log("\nFILES TRACKED - Purpose (code-intent)\n──────────────────────────────────────");
        for (const [file, purpose] of results) {
          const shortPath = file.replace(process.env.HOME || "", "~");
          console.log(`  ${shortPath}`);
          console.log(`    → ${purpose}\n`);
        }
        ctx.ui.notify("Brain enrichment written to console", "info");
        return;
      }

      ctx.ui.notify("Unknown command. Run /brains help for available commands.", "warning");
    },
  });
}

async function initializeBrains(controller: PiBrainsController, ctx: ExtensionContext): Promise<void> {
  // Check availability without sending anything to the model. Session startup
  // normally performs this check; retry explicitly if it is still pending.
  let gscAvailable = controller.getGscStatus() === "available";
  if (controller.getGscStatus() === "checking") {
    const result = await controller.runGscCommand("--version");
    gscAvailable = result?.code === 0;
  }
  if (!gscAvailable) {
    const installMsg = `gsc not found. GitSense provides repository-aware rules and expert context for coding agents.

Install via curl:
  curl https://raw.githubusercontent.com/gitsense/chat/refs/heads/main/install.sh | bash

Or download a prebuilt binary:
  https://github.com/gitsense/chat/releases

Build from source (Go 1.21+):
  git clone https://github.com/gitsense/gsc-cli && cd gsc-cli && make build

Once installed, run /brains again to enable expert context.`;
    ctx.ui.notify(installMsg, "warning");
    return;
  }

  const initialized = controller.hasRunExpertsInit(ctx);
  const choice = await ctx.ui.select("GitSense Brains", [
    initialized ? "Reinitialize expert context" : "Initialize expert context",
    "Help",
    "Cancel",
  ]);
  if (!choice || choice === "Cancel") return;
  if (choice === "Help") {
    showHelp(ctx as unknown as ExtensionCommandContext);
    return;
  }
  controller.sendUserMessage("run `gsc experts init` and follow instructions");
}

async function handleRulesCommand(value: string | undefined, controller: PiBrainsController, ctx: ExtensionCommandContext): Promise<void> {
  const rulesEnabled = controller.isRulesEnabled();
  const normalized = value?.trim() ?? "";

  if (normalized === "shell" || normalized.startsWith("shell ")) {
    await handleShellRulesCommand(normalized.slice("shell".length).trim(), controller, ctx);
    return;
  }

  if (normalized === "recorder" || normalized.startsWith("recorder ")) {
    await handleRecorderRulesCommand(normalized.slice("recorder".length).trim(), controller, ctx);
    return;
  }

  // /brains rules on
  if (value === "on") {
    controller.setRulesEnabled(true);
    ctx.ui.notify("Rules checking enabled", "info");
    return;
  }

  // /brains rules off
  if (value === "off") {
    controller.setRulesEnabled(false);
    ctx.ui.notify("Rules checking disabled", "info");
    return;
  }

  // /brains rules status
  if (value === "status") {
    ctx.ui.notify(controller.getRulesStatus(), "info");
    return;
  }

  // /brains rules - show status
  const status = rulesEnabled ? "ON" : "OFF";
  const rulesHelp = `Rules checking: ${status}

Rules are checked before read, edit, and write tool calls. When a
matching rule has not been delivered yet, pi-brains blocks the tool call,
injects the matched instructions, and lets the agent retry with context.

  /brains rules off    Disable rules checking
  /brains rules on     Enable rules checking
  /brains rules status Show recent rule decisions
  /brains rules shell  Configure observable shell discovery
  /brains rules recorder personal  Install the personal Pi edit recorder

Managing rules:

  Ask the agent to add, update, or delete rules. Examples:
    "Add a rule for packages/ai/src that requires running npm run check"
    "Update rule <id> to include test files"
    "Delete rule <id>"`;
  ctx.ui.notify(rulesHelp, "info");
}

async function handleInspectCommand(_value: string | undefined, controller: PiBrainsController, ctx: ExtensionCommandContext): Promise<void> {
  const sessionId = controller.getSessionId();
  const cwd = controller.getCwd();

  // Build the gsc command
  const gscCmd = sessionId
    ? `gsc pi inspect ${sessionId}`
    : `gsc pi inspect --cwd ${quoteShellArg(cwd)} --wait`;

  // Detect OS for terminal shortcuts
  const platform = process.platform;
  const shortcuts: string[] = [];

  if (platform === "darwin") {
    shortcuts.push("iTerm2 / Ghostty: Cmd+D");
    shortcuts.push("tmux: Ctrl-b %");
    shortcuts.push("Terminal.app: Cmd+T (new tab)");
  } else if (platform === "linux") {
    shortcuts.push("tmux: Ctrl-b %");
    shortcuts.push("Ghostty: Ctrl+Shift+D");
  } else if (platform === "win32") {
    shortcuts.push("Windows Terminal: Alt+Shift+=");
  }

  // Check if web server is running
  const chatAppStatus = await getChatAppStatus(controller);
  const dialog = buildInspectDialog({
    sessionId,
    gscCommand: gscCmd,
    shortcuts,
    chatAppStatus,
  });

  // Show select dialog
  const choice = await ctx.ui.select(dialog.message, dialog.options.map(option => option.label));
  const action = dialog.options.find(option => option.label === choice)?.action;

  // Handle choice
  if (action === "copy-terminal") {
    try {
      await copyToClipboard(gscCmd);
      ctx.ui.notify("Command copied to clipboard", "info");
    } catch (error) {
      ctx.ui.notify(`Failed to copy command: ${formatError(error)}`, "error");
    }
  } else if (action === "open-chat") {
    try {
      await openExternalUrl(dialog.chatUrl, platform);
      ctx.ui.notify(`Opening ${dialog.chatUrl}`, "info");
    } catch (error) {
      ctx.ui.notify(`Failed to open browser: ${formatError(error)}`, "error");
    }
  } else if (action === "copy-chat-url") {
    try {
      await copyToClipboard(dialog.chatUrl);
      ctx.ui.notify("URL copied to clipboard", "info");
    } catch (error) {
      ctx.ui.notify(`Failed to copy URL: ${formatError(error)}`, "error");
    }
  } else if (action === "copy-start") {
    await copyCommand("gsc app native start", "Start command", ctx);
  } else if (action === "copy-install") {
    await copyCommand("gsc app native install", "Install command", ctx);
  }
}

async function copyCommand(command: string, label: string, ctx: ExtensionCommandContext): Promise<void> {
  try {
    await copyToClipboard(command);
    ctx.ui.notify(`${label} copied to clipboard`, "info");
  } catch (error) {
    ctx.ui.notify(`Failed to copy command: ${formatError(error)}`, "error");
  }
}

function quoteShellArg(value: string): string {
  if (process.platform === "win32") {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function handleBuildCommand(value: string | undefined, controller: PiBrainsController, ctx: ExtensionCommandContext): Promise<void> {
  const args = (value ?? "").trim().split(/\s+/).filter(Boolean);
  const force = args.includes("--force");
  const manifest = args.find(arg => arg !== "--force");

  if (manifest === "help") {
    const brains = await controller.runGscBrains();
    const help = `Build a Brain from a GitSense manifest.

Usage:

  /brains build
  /brains build <brain-name>
  /brains build <manifest-path-or-url>
  /brains build --force
  /brains build <brain-name> --force

With no name, pi-brains imports every manifest in .gitsense/manifests.

Named builds run:

  gsc manifest import <brain-name-or-manifest-path-or-url>

For a name like "code-intent", gsc looks for .gitsense/manifests/code-intent.json. Building Brains writes to .gitsense and may take time. pi-brains will not build Brains automatically unless you explicitly ask.

Current Brains:

${brains || "No active Brains found."}`;
    ctx.ui.notify(help, "info");
    return;
  }

  const output = manifest
    ? await controller.buildBrain(manifest, { force })
    : await controller.buildAllBrains({ force });
  ctx.ui.notify(output || `Brain build completed${manifest ? ` for ${manifest}` : ""}`, "info");
}

function showAbout(ctx: ExtensionCommandContext): void {
  const about = `GitSense (gsc) turns domain knowledge into queryable intelligence for coding agents.

What gsc can do:

  Search with meaning    gsc rg <pattern> --db <brain> --fields purpose
  Query by concept       gsc query --db <brain> --filter "..."
  Build Brains           /brains build <brain-name>
  Check blast radius     gsc query --db <brain> --glob <file> --fields coupling_risk
  Capture lessons        gsc lessons add --summary "..." --instruction "..."
  Define rules           gsc rules add --glob "**/*.ts" --summary "..." --instruction "..."
  Initialize agents      gsc experts init

Learn by doing:

  smart-ripgrep          https://github.com/gitsense/smart-ripgrep
  smart-codex            https://github.com/gitsense/smart-codex

Source and documentation:

  gsc CLI                https://github.com/gitsense/gsc-cli
  GitSense Chat          https://github.com/gitsense/chat

Run \`gsc --help\` for the full command reference.`;
  ctx.ui.notify(about, "info");
}

async function handleCheckpointCommand(value: string | undefined, pi: ExtensionAPI, controller: PiBrainsController, ctx: ExtensionContext): Promise<void> {
  // /brains checkpoint exit - return to main branch
  if (value === "exit") {
    const sessionId = controller.getSessionId();
    const sessionFile = ctx.sessionManager.getSessionFile();
    const leafId = ctx.sessionManager.getLeafId();
    const cwd = ctx.cwd;
    
    if (!sessionId) {
      ctx.ui.notify("No active session", "error");
      return;
    }
    
    const result = await handleCheckpointExit({
      pi,
      ctx: ctx as unknown as ExtensionCommandContext,
      controller,
      sessionId,
      sessionFile: sessionFile ?? null,
      leafId: leafId ?? null,
      cwd,
    });
    
    if (!result.success) {
      ctx.ui.notify(`Failed to exit checkpoint: ${result.error}`, "error");
    }
    return;
  }

  // /brains checkpoint - create checkpoint now
  debugLog("Starting checkpoint command");
  
  // Update leaf ID from current session state before checkpoint
  const currentLeafId = ctx.sessionManager.getLeafId();
  controller.updateGuideLeafId(currentLeafId);

  // Get session info
  const sessionId = controller.getSessionId();
  const sessionFile = ctx.sessionManager.getSessionFile();
  const leafId = ctx.sessionManager.getLeafId();
  const cwd = ctx.cwd;
  
  debugLog("Session info", { sessionId, sessionFile: sessionFile?.slice(-50), leafId, cwd });
  
  // Validate session
  if (!sessionId) {
    debugLog("No session ID, aborting");
    ctx.ui.notify("No active session. Start a conversation first.", "error");
    return;
  }
  
  // Hand off to checkpoint handler
  debugLog("Calling handleCheckpoint");
  
  const result = await handleCheckpoint({
    pi,
    ctx: ctx as unknown as ExtensionCommandContext,
    controller,
    sessionId,
    sessionFile: sessionFile ?? null,
    leafId,
    cwd,
  });
  
  debugLog("handleCheckpoint result", result);
  
  // Handle result
  if (result.success) {
    debugLog("Success, notifying user");
    ctx.ui.notify(`✓ Checkpoint created: ${result.checkpointId}`, "info");
  } else if (result.error !== "cancelled") {
    debugLog("Failed", { error: result.error });
    ctx.ui.notify(`✗ Checkpoint failed: ${result.error}`, "error");
  } else {
    debugLog("Cancelled by user");
  }
}

/**
 * Create a checkpoint message on a scratch branch.
 * Uses in-session scratch branch (same session file, no separate file).
 * Creates a custom_message that would enter scratch branch context but does not trigger LLM.
 */
async function createGuideCheckpointMessage(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  controller: PiBrainsController,
  checkpointResult: GuideCheckpointRequestResult,
): Promise<void> {
  const guideDebug = controller.getGuideDebugLogger();
  const { checkpointId, anchorLeafId, sessionId } = checkpointResult;

  // Capture current leaf ID from session manager (not cached)
  const originalLeafId = ctx.sessionManager.getLeafId();
  const sourceSessionPath = ctx.sessionManager.getSessionFile() ?? null;

  // Log message started
  guideDebug.logCheckpointMessageStarted({
    checkpointId,
    anchorLeafId,
    originalLeafId,
    sourceSessionPath,
  });

  try {
    // Wait for agent to finish streaming
    await ctx.waitForIdle();

    // Navigate to anchor leaf (creates in-session branch)
    if (anchorLeafId) {
      await ctx.navigateTree(anchorLeafId, { summarize: false });
    }

    // Create checkpoint custom_message on scratch branch
    // triggerTurn: false prevents LLM completion
    pi.sendMessage(
      {
        customType: "guide-checkpoint-request",
        display: false,
        content: JSON.stringify({
          type: "guide_checkpoint_request",
          schemaVersion: 1,
          checkpointId,
          anchorLeafId,
          originalLeafId,
          source: "manual",
          scratch: true,
          instruction:
            "This is a staged checkpoint request for Work State generation. Do not treat this as part of the main user conversation.",
        }),
        details: {
          checkpointId,
          anchorLeafId,
          originalLeafId,
          source: "manual",
          scratch: true,
        },
      },
      { triggerTurn: false },
    );

    // Log message created
    guideDebug.logCheckpointMessageCreated({
      checkpointId,
      anchorLeafId,
      originalLeafId,
      sourceSessionPath,
    });

    // Navigate back to original leaf
    if (originalLeafId) {
      await ctx.navigateTree(originalLeafId, { summarize: false });
    }

    // Log message restored
    guideDebug.logCheckpointMessageRestored({
      checkpointId,
      anchorLeafId,
      originalLeafId,
      sourceSessionPath,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Try to restore original leaf on failure
    try {
      if (originalLeafId) {
        await ctx.navigateTree(originalLeafId, { summarize: false });
      }
    } catch {
      // Best effort restore
    }

    // Log failure
    guideDebug.logCheckpointMessageFailed({
      checkpointId,
      anchorLeafId,
      originalLeafId,
      sourceSessionPath,
      error: errorMsg,
    });

    // Notify user
    ctx.ui.notify(
      "Checkpoint message creation failed. Your chat was restored and you can continue.",
      "warning",
    );
  }
}

/**
 * Create a checkpoint with the agent on a scratch branch.
 * Uses in-session scratch branch (same session file, no separate file).
 * Sends a user message with checkpoint instructions that triggers the LLM.
 */
async function createCheckpointWithAgent(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  controller: PiBrainsController,
  checkpointResult: GuideCheckpointRequestResult,
): Promise<void> {
  const guideDebug = controller.getGuideDebugLogger();
  const { checkpointId, anchorLeafId, sessionId } = checkpointResult;

  // Capture current leaf ID from session manager (not cached)
  const originalLeafId = ctx.sessionManager.getLeafId();
  const sourceSessionPath = ctx.sessionManager.getSessionFile() ?? null;

  // Log message started
  guideDebug.logCheckpointMessageStarted({
    checkpointId,
    anchorLeafId,
    originalLeafId,
    sourceSessionPath,
  });

  try {
    // Wait for agent to finish streaming
    await ctx.waitForIdle();

    // Navigate to anchor leaf (creates in-session branch)
    if (anchorLeafId) {
      await ctx.navigateTree(anchorLeafId, { summarize: false });
    }

    // Build checkpoint instructions for the agent
    const checkpointInstructions = buildCheckpointInstructions(
      checkpointId,
      sessionId,
      originalLeafId,
      controller,
    );

    // Send user message with checkpoint instructions
    // followUp will deliver the message after the current turn completes
    pi.sendUserMessage(checkpointInstructions, { deliverAs: "followUp" });

    // Log message created
    guideDebug.logCheckpointMessageCreated({
      checkpointId,
      anchorLeafId,
      originalLeafId,
      sourceSessionPath,
    });

    // Navigate back to original leaf
    if (originalLeafId) {
      await ctx.navigateTree(originalLeafId, { summarize: false });
    }

    // Log message restored
    guideDebug.logCheckpointMessageRestored({
      checkpointId,
      anchorLeafId,
      originalLeafId,
      sourceSessionPath,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Try to restore original leaf on failure
    try {
      if (originalLeafId) {
        await ctx.navigateTree(originalLeafId, { summarize: false });
      }
    } catch {
      // Best effort restore
    }

    // Log failure
    guideDebug.logCheckpointMessageFailed({
      checkpointId,
      anchorLeafId,
      originalLeafId,
      sourceSessionPath,
      error: errorMsg,
    });

    // Notify user
    ctx.ui.notify(
      "Checkpoint creation failed. Your chat was restored and you can continue.",
      "warning",
    );
  }
}

/**
 * Build checkpoint instructions for the agent.
 * These instructions tell the agent how to create a checkpoint using gsc sessions.
 */
function buildCheckpointInstructions(
  checkpointId: string,
  sessionId: string | null,
  anchorLeafId: string | null,
  controller: PiBrainsController,
): string {
  const sessionInfo = sessionId ? `Session ID: ${sessionId}` : "Session ID: (not available)";
  const anchorInfo = anchorLeafId ? `Anchor Leaf ID: ${anchorLeafId}` : "Anchor Leaf ID: (not available)";
  const repoPath = controller.getCwd();
  
  // Build the instructions
  let instructions = `# Checkpoint Creation Request\n\n`;
  instructions += `A checkpoint has been requested to capture your current work state.\n\n`;
  instructions += `## Context\n`;
  instructions += `- ${sessionInfo}\n`;
  instructions += `- ${anchorInfo}\n`;
  instructions += `- Checkpoint ID: ${checkpointId}\n`;
  instructions += `- Repository: ${repoPath}\n\n`;
  
  instructions += `## Instructions\n\n`;
  instructions += `1. **Review previous checkpoints** (if any):\n`;
  instructions += `   \`\`\`bash\n`;
  instructions += `   gsc sessions checkpoints list --session ${sessionId || "unknown"}\n`;
  instructions += `   \`\`\`\n\n`;
  
  instructions += `2. **Generate a checkpoint template**:\n`;
  instructions += `   \`\`\`bash\n`;
  instructions += `   gsc sessions checkpoints template \\\n`;
  instructions += `     --session ${sessionId || "unknown"} \\\n`;
  instructions += `     --agent pi \\\n`;
  instructions += `     --anchor-leaf ${anchorLeafId || "unknown"} \\\n`;
  instructions += `     --out .gitsense/sessions/checkpoint-${checkpointId}.json\n`;
  instructions += `   \`\`\`\n\n`;
  
  instructions += `3. **Edit the template** and fill in the placeholder values:\n`;
  instructions += `   - problem: What were you trying to accomplish?\n`;
  instructions += `   - reasoning: What was your thought process?\n`;
  instructions += `   - decisions: What key decisions did you make?\n`;
  instructions += `   - risks: What risks or uncertainties did you identify?\n`;
  instructions += `   - files: What files did you touch?\n`;
  instructions += `   - tools: What tools did you use?\n\n`;
  
  instructions += `4. **Validate the checkpoint**:\n`;
  instructions += `   \`\`\`bash\n`;
  instructions += `   gsc sessions checkpoints validate \\\n`;
  instructions += `     --from-file .gitsense/sessions/checkpoint-${checkpointId}.json\n`;
  instructions += `   \`\`\`\n\n`;
  
  instructions += `5. **Create the checkpoint** from the JSON file:\n`;
  instructions += `   \`\`\`bash\n`;
  instructions += `   gsc sessions checkpoints append \\\n`;
  instructions += `     --from-file .gitsense/sessions/checkpoint-${checkpointId}.json \\\n`;
  instructions += `     --repo ${repoPath} \\\n`;
  instructions += `     --target personal\n`;
  instructions += `   \`\`\`\n\n`;
  
  instructions += `6. **Verify the checkpoint was created**:\n`;
  instructions += `   \`\`\`bash\n`;
  instructions += `   gsc sessions checkpoints show ${checkpointId}\n`;
  instructions += `   \`\`\`\n\n`;
  
  instructions += `## Important Notes\n`;
  instructions += `- Do NOT include raw transcripts or tool output\n`;
  instructions += `- Summarize problem, reasoning, decisions, risks, files, and tools\n`;
  instructions += `- The checkpoint should be concise and code-review friendly\n`;
  instructions += `- After creating the checkpoint, inform the user of the result\n`;
  instructions += `\n`;
  instructions += `## Flag Reference\n`;
  instructions += `\n`;
  instructions += `| Flag | Purpose |\n`;
  instructions += `| :--- | :--- |\n`;
  instructions += `| \`--repo <path>\` | Repository path for git metadata (always required) |\n`;
  instructions += `| \`--target personal\` | Write to personal scope (default, not committed to repo) |\n`;
  instructions += `| \`--target repo\` | Write to repo scope (committed, must have safeToCommit: true) |\n`;
  instructions += `\n`;
  instructions += `## Privacy Fields for Personal Scope\n`;
  instructions += `\n`;
  instructions += `When using \`--target personal\`, the JSON must include:\n`;
  instructions += `\`\`\`json\n`;
  instructions += `{\n`;
  instructions += `  "privacy": {\n`;
  instructions += `    "containsTranscript": false,\n`;
  instructions += `    "containsRawToolOutput": false,\n`;
  instructions += `    "safeToCommit": false\n`;
  instructions += `  }\n`;
  instructions += `}\n`;
  instructions += `\`\`\`\n`;
  
  return instructions;
}

// /brains show-compact-messages handler
async function handleShowCompactMessages(
  controller: PiBrainsController,
  ctx: ExtensionCommandContext
): Promise<void> {
  const sessionId = controller.getSessionId();
  if (!sessionId) {
    ctx.ui.notify("No active session", "error");
    return;
  }

  try {
    // Get compaction data via gsc (include summaries)
    const result = await controller.runGscCommand(
      "pi", "inspect", "overview",
      "--session", sessionId,
      "--format", "json",
      "--include", "compaction-summaries"
    );

    if (!result || result.code !== 0) {
      ctx.ui.notify("Failed to load compaction data", "error");
      return;
    }

    const data = JSON.parse(result.stdout);
    const compactions = data?.compactions?.items || [];

    if (compactions.length === 0) {
      ctx.ui.notify("No compaction messages found", "info");
      return;
    }

    // Build notice with compacted messages
    let notice = `COMPACTION MESSAGES (${compactions.length})\n`;
    notice += "═".repeat(50) + "\n\n";

    for (const compaction of compactions) {
      const time = compaction.timestamp 
        ? new Date(compaction.timestamp).toLocaleString("en-US", { 
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" 
          })
        : "unknown";
      
      notice += `[${time}] ${compaction.tokens_before?.toLocaleString() || "?"} tokens · ${compaction.file_count || "?"} files\n`;
      notice += "─".repeat(40) + "\n";
      
      if (compaction.summary) {
        notice += compaction.summary + "\n";
      } else {
        notice += "(no summary available)\n";
      }
      notice += "\n";
    }

    ctx.ui.notify(notice, "info");
  } catch (error) {
    ctx.ui.notify(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

// State for tracking post-compact branch
let inPostCompactBranch = false;
let postCompactOriginalLeafId: string | null = null;
let postCompactCtx: ExtensionCommandContext | null = null;

/**
 * Initialize post-compact event handlers
 */
export function initPostCompactHandlers(pi: ExtensionAPI): void {
  pi.on("agent_end", async (event, ctx) => {
    if (inPostCompactBranch && postCompactOriginalLeafId && postCompactCtx) {
      debugLog("Agent ended in post-compact branch, parsing output");
      
      // Wait for agent to fully finish
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Parse POST_COMPACT_NOTE_ID from last message
      const lastMessage = event.messages?.[event.messages.length - 1] as any;
      let content = "";
      if (lastMessage?.content) {
        if (typeof lastMessage.content === "string") {
          content = lastMessage.content;
        } else if (Array.isArray(lastMessage.content)) {
          content = lastMessage.content
            .filter((block: any) => block.type === "text")
            .map((block: any) => block.text || "")
            .join("\n");
        }
      }
      const match = content.match(/POST_COMPACT_NOTE_ID=([a-zA-Z0-9_-]+)/);
      
      if (!match) {
        debugLog("No POST_COMPACT_NOTE_ID found in output", { content: content.slice(-200) });
        postCompactCtx.ui.notify("Post-compact enrichment failed: no note ID returned", "error");
      } else {
        const noteId = match[1];
        debugLog("Found note ID", { noteId });
        
        // Read the note back
        try {
          const result = await pi.exec("gsc", ["notes", "show", noteId, "--scope", "personal", "-o", "json"], {
            timeout: 10_000,
          });
          
          if (result.code === 0 && result.stdout) {
            const note = JSON.parse(result.stdout);
            debugLog("Note read successfully", { noteId, summary: note.summary });
            
            // Inject post-compact message on main branch
            const message = buildPostCompactMessage(noteId, note);
            postCompactCtx.ui.notify(message, "info");
            
            // Navigate back to main branch
            try {
              await postCompactCtx.navigateTree(postCompactOriginalLeafId, { summarize: false });
              debugLog("Navigated back to main branch");
              postCompactCtx.ui.notify("Returned to main branch with post-compact context", "info");
            } catch (error) {
              debugLog("Error navigating back", { error: error instanceof Error ? error.message : String(error) });
            }
          } else {
            debugLog("Failed to read note", { code: result.code, stderr: result.stderr });
            postCompactCtx.ui.notify(`Failed to read note ${noteId}`, "error");
          }
        } catch (error) {
          debugLog("Error reading note", { error: error instanceof Error ? error.message : String(error) });
          postCompactCtx.ui.notify(`Error reading note: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      }
      
      // Reset state
      inPostCompactBranch = false;
      postCompactOriginalLeafId = null;
      postCompactCtx = null;
    }
  });
}

// /brains post-compact handler
async function handlePostCompact(
  pi: ExtensionAPI,
  controller: PiBrainsController,
  ctx: ExtensionCommandContext
): Promise<void> {
  const sessionId = controller.getSessionId();
  if (!sessionId) {
    ctx.ui.notify("No active session", "error");
    return;
  }

  const sessionFile = ctx.sessionManager.getSessionFile?.() ?? null;
  const leafId = ctx.sessionManager.getLeafId?.() ?? null;
  const cwd = controller.getCwd();

  // Get latest compaction data
  const compactionResult = await controller.runGscCommand(
    "pi", "inspect", "overview",
    "--session", sessionId,
    "--format", "json",
    "--include", "compaction-summaries"
  );

  if (!compactionResult || compactionResult.code !== 0) {
    ctx.ui.notify("Failed to load compaction data", "error");
    return;
  }

  const overviewData = JSON.parse(compactionResult.stdout);
  const compactions = overviewData?.compactions?.items || [];
  
  if (compactions.length === 0) {
    ctx.ui.notify("No compactions found for this session", "error");
    return;
  }

  const latestCompaction = compactions[0];
  const checkpoint = overviewData?.checkpoint;

  // Build enrichment instructions
  const instructions = buildPostCompactInstructions(
    sessionId,
    latestCompaction,
    checkpoint,
    cwd
  );

  // Create scratch branch
  const originalLeafId = ctx.sessionManager.getLeafId();
  if (!originalLeafId) {
    ctx.ui.notify("No original leaf ID", "error");
    return;
  }

  try {
    // Navigate to scratch branch
    await ctx.navigateTree(originalLeafId, { summarize: false });
    debugLog("Post-compact scratch branch created");

    // Set state for tracking
    inPostCompactBranch = true;
    postCompactOriginalLeafId = originalLeafId;
    postCompactCtx = ctx as unknown as ExtensionCommandContext;

    // Send instructions
    pi.sendUserMessage(instructions);
    ctx.ui.notify("Post-compact enrichment started. Creating durable note...", "info");
  } catch (error) {
    debugLog("Error creating post-compact branch", { error: error instanceof Error ? error.message : String(error) });
    ctx.ui.notify(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

// Build post-compact enrichment instructions
function buildPostCompactInstructions(
  sessionId: string,
  compaction: any,
  checkpoint: any,
  repoPath: string
): string {
  const compactionId = compaction.entry_id || "unknown";
  const checkpointId = checkpoint?.id || "none";
  const fileCount = compaction.file_count || 0;
  const readCount = compaction.read_file_count || 0;
  const modifiedCount = compaction.modified_file_count || 0;
  const checkpointTagLine = checkpointId !== "none" ? `\n  - checkpoint:${checkpointId}` : "";
  const checkpointJSONTag = checkpointId !== "none" ? `,\n    "checkpoint:${checkpointId}"` : "";

  let instructions = `You are creating a post-compaction enrichment note for the current Pi session.

Goal:
Create a durable GitSense note that summarizes what should be carried forward after the latest compaction. This note will later be read by /brains post-compact and inserted into the main chat as a post-compaction message.

Inputs to inspect:
1. Latest compaction summary for this session.
2. Latest checkpoint for this session, if any.
3. Files listed by the compaction as read or modified.
4. Code-intent brain metadata for those files, if available (a GitSense brain that maps files to their purposes). Note: The code-intent brain may exist in multiple repositories (e.g., ~/gsc-cli, ~/pi-brains, ~/pi). Check each repo separately.

Session: ${sessionId}
Compaction: ${compactionId}
Checkpoint: ${checkpointId}
Files: ${fileCount} total (${readCount} read, ${modifiedCount} modified)

Rules:
- Do not edit source code.
- Do not rewrite the original compaction.
- Do not create a checkpoint.
- Do not include speculative facts.
- Prefer concise, high-signal context.
- If checkpoint and compaction disagree, call out the disagreement.
- If the code-intent brain is not available or missing for a file, omit that file or mark it as "unknown purpose".
- Write exactly one GitSense note.
- Report the created note id at the end.

Create the note with:
- target: personal
- topic: pi-session-memory
- importance: high
- tags:
  - pi-post-compact
  - session:${sessionId}
  - compaction:${compactionId}${checkpointTagLine}

Note JSON shape:

{
  "summary": "Post-compaction context for session ${sessionId.slice(0, 8)}",
  "content": "...",
  "topic": "pi-session-memory",
  "glob_patterns": [],
  "linked_files": [],
  "tags": [
    "pi-post-compact",
    "session:${sessionId}",
    "compaction:${compactionId}"${checkpointJSONTag}
  ],
  "importance": "high"
}

Content format:

## Post-Compaction Context

### Carry Forward
- ...

### Risks
- ...

### Open Questions
- ...

### File Context
- path/to/file: one-line purpose and why it mattered in the compacted work.

### State Delta
- Latest checkpoint: ...
- Latest compaction: ...
- Any stale/conflicting state: ...

Steps:
1. Read the compaction summary: gsc pi inspect overview --session ${sessionId} --format json --include compaction-summaries
2. Read the checkpoint data (included in the overview JSON)
3. Get file purposes from the code-intent brain (if available):
   - The code-intent brain may exist in multiple repositories. Check each:
     - Current repo: gsc brains --json
     - Other repos mentioned in compaction files: cd <repo-path> && gsc brains --json
   - For each repo with a code-intent brain, query it: gsc brains query code-intent --scope personal
   - The code-intent brain maps files to their purposes (e.g., "This file handles...")
   - Use this to add one-line file descriptions in the File Context section
   - If a brain is not available for a repo, mark those files as "unknown purpose"
4. Write the note JSON to /tmp/pi-post-compact-note.json
5. Create the note: gsc notes add --target personal --from-file /tmp/pi-post-compact-note.json
6. Validate: gsc notes show <note-id> --scope personal -o json

Validation:
After creating the note, run:

gsc notes show <note-id> --scope personal -o json

If verification fails, report the error and do not claim success.

Final response:
If successful, respond with exactly:

POST_COMPACT_NOTE_ID=<note-id>

No extra prose.
`;

  return instructions;
}

// Build post-compact message for main branch
function buildPostCompactMessage(noteId: string, note: any): string {
  const timestamp = new Date().toISOString();
  const summary = note.summary || "Post-compaction enrichment";
  const content = note.content || "";
  
  let message = `[Post-Compact Context] ${summary}\n`;
  message += `Note ID: ${noteId}\n`;
  message += `Created: ${timestamp}\n\n`;
  message += content;
  
  return message;
}

function showHelp(ctx: ExtensionCommandContext): void {
  const help = `/brains commands:

  /brains              Show initialization and help options
  /brains status       Show current GitSense configuration
  /brains build        Build/import a Brain manifest
  /brains checkpoint   Create a review checkpoint now
  /brains inspect      Inspect the live Pi session in a terminal or browser
  /brains inbox        Review messages drafted in GitSense Chat
  /brains inbox list   List all messages in the session inbox
  /brains insights     Show a static inspect snapshot
  /brains rules        Configure rules and show available options
  /brains scm          Show compacted messages (alias: show-compact-messages)
  /brains pc           Post-compact enrichment (alias: post-compact)
  /brains debug        Toggle debug mode
  /brains debug on     Enable debug mode
  /brains debug off    Disable debug mode
  /brains debug file   Show debug log file path
  /brains about        What GitSense can do
  /brains help         This message`;
  ctx.ui.notify(help, "info");
}
