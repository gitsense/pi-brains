import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { loadConfig } from "./config.ts";
import { PiBrainsController, type GuideCheckpointRequestResult } from "./controller.ts";

export default async function piBrains(pi: ExtensionAPI): Promise<void> {
  const config = await loadConfig();
  const controller = new PiBrainsController(pi, config);

  // Register message renderers for brains output
  pi.registerMessageRenderer("brains-install", (message, _options, theme) => {
    const content = typeof message.content === "string" ? message.content : "";
    const prefix = theme.fg("warning", "[brains-install]");
    return new Text(prefix + "\n\n" + content, 0, 0);
  });

  pi.registerMessageRenderer("brains-insights", (message, _options, theme) => {
    const content = typeof message.content === "string" ? message.content : "";
    const prefix = theme.fg("accent", "[brains-insights]");
    return new Text(prefix + "\n\n" + content, 0, 0);
  });

  pi.registerMessageRenderer("brains-help", (message, _options, theme) => {
    const content = typeof message.content === "string" ? message.content : "";
    const prefix = theme.fg("accent", "[brains-help]");
    return new Text(prefix + "\n\n" + content, 0, 0);
  });

  pi.registerMessageRenderer("brains-rules", (message, _options, theme) => {
    const content = typeof message.content === "string" ? message.content : "";
    const prefix = theme.fg("accent", "[brains-rules]");
    return new Text(prefix + "\n\n" + content, 0, 0);
  });

  pi.registerMessageRenderer("brains-about", (message, _options, theme) => {
    const content = typeof message.content === "string" ? message.content : "";
    const prefix = theme.fg("accent", "[brains-about]");
    return new Text(prefix + "\n\n" + content, 0, 0);
  });

  pi.registerMessageRenderer("brains-context", (message, _options, theme) => {
    const content = typeof message.content === "string" ? message.content : "";
    const prefix = theme.fg("accent", "[brains-context]");
    return new Text(prefix + "\n\n" + content, 0, 0);
  });

  pi.registerMessageRenderer("brains-build", (message, _options, theme) => {
    const content = typeof message.content === "string" ? message.content : "";
    const prefix = theme.fg("accent", "[brains-build]");
    return new Text(prefix + "\n\n" + content, 0, 0);
  });

  pi.registerMessageRenderer("brains-inspect", (message, _options, theme) => {
    const content = typeof message.content === "string" ? message.content : "";
    const prefix = theme.fg("accent", "[brains-inspect]");
    return new Text(prefix + "\n\n" + content, 0, 0);
  });

  pi.on("session_start", (_event, ctx) => {
    controller.start(ctx);
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

    // Guide mode: detect and remove Work State marker
    if (controller.isGuideEnabled() && event.message.role === "assistant") {
      const cleanedMessage = controller.processAssistantMessageForMarker(
        event.message as unknown as Record<string, unknown>
      );
      if (cleanedMessage) {
        // Record pending checkpoint suggestion
        const leafId = ctx.sessionManager.getLeafId();
        controller.recordCheckpointSuggestion(leafId, leafId);
        
        const suggestionCount = controller.getSuggestionCount();
        const countText = suggestionCount > 1 ? ` (${suggestionCount})` : "";
        ctx.ui.notify(`Checkpoint suggested${countText}. Run /brains checkpoint to create.`, "info");
        return { message: cleanedMessage as any };
      }
    }

    return undefined;
  });

  pi.on("session_compact", (_event, ctx) => {
    controller.refreshSessionState(ctx);
  });

  pi.on("agent_end", (event, ctx) => {
    return controller.handleStop(event, ctx);
  });

  pi.on("session_shutdown", () => {
    controller.dispose();
  });

  pi.registerCommand("brains", {
    description: "Manage pi-brains and rules",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const command = parts[0];
      const value = parts.slice(1).join(" ");

      // /brains - initialize expert context
      if (!command) {
        await initializeBrains(controller, pi, ctx as unknown as ExtensionContext);
        return;
      }

      // /brains insights - show the current inspect state as a static message
      if (command === "insights") {
        const output = controller.renderInsightsSnapshot();
        pi.sendMessage({
          customType: "brains-insights",
          content: output || "No insights available",
          display: true,
        });
        return;
      }

      // /brains build - build/import a Brain manifest
      if (command === "build") {
        await handleBuildCommand(value, controller, pi);
        return;
      }

      // /brains rules - show rules status
      if (command === "rules") {
        handleRulesCommand(value, controller, pi);
        return;
      }

      // /brains inspect - open/close inspect view
      if (command === "inspect") {
        await handleInspectCommand(value, controller, pi);
        return;
      }

      // /brains about - what GitSense can do
      if (command === "about") {
        showAbout(pi);
        return;
      }

      // /brains help - show available commands
      if (command === "help") {
        showHelp(pi);
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

      // /brains guide - deprecated (alias for checkpoint suggest)
      if (command === "guide") {
        handleDeprecatedGuideCommand(value, pi, controller, ctx as unknown as ExtensionContext);
        return;
      }

      // /brains checkpoint - create checkpoint or manage suggestions
      if (command === "checkpoint") {
        handleCheckpointCommand(value, pi, controller, ctx as unknown as ExtensionContext);
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

async function initializeBrains(controller: PiBrainsController, pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  // Check if gsc is available
  const gscStatus = controller.getGscStatus();
  if (gscStatus === "missing") {
    const installMsg = `gsc not found. GitSense provides repository-aware rules and expert context for coding agents.

Install via curl:
  curl https://raw.githubusercontent.com/gitsense/chat/refs/heads/main/install.sh | bash

Or download a prebuilt binary:
  https://github.com/gitsense/chat/releases

Build from source (Go 1.21+):
  git clone https://github.com/gitsense/gsc-cli && cd gsc-cli && make build

Once installed, run /brains again to enable expert context.`;
    pi.sendMessage({
      customType: "brains-install",
      content: installMsg,
      display: true,
    });
    return;
  }

  // Check if agent has already run gsc experts init
  if (controller.hasRunExpertsInit(ctx)) {
    showHelp(pi);
    return;
  }

  // Send user message to agent
  controller.sendUserMessage("run `gsc experts init` and follow instructions");
}

function handleRulesCommand(value: string | undefined, controller: PiBrainsController, pi: ExtensionAPI): void {
  const rulesEnabled = controller.isRulesEnabled();

  // /brains rules on
  if (value === "on") {
    controller.setRulesEnabled(true);
    pi.sendMessage({
      customType: "brains-rules",
      content: "Rules checking enabled",
      display: true,
    });
    return;
  }

  // /brains rules off
  if (value === "off") {
    controller.setRulesEnabled(false);
    pi.sendMessage({
      customType: "brains-rules",
      content: "Rules checking disabled",
      display: true,
    });
    return;
  }

  // /brains rules status
  if (value === "status") {
    pi.sendMessage({
      customType: "brains-rules",
      content: controller.getRulesStatus(),
      display: true,
    });
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

Managing rules:

  Ask the agent to add, update, or delete rules. Examples:
    "Add a rule for packages/ai/src that requires running npm run check"
    "Update rule <id> to include test files"
    "Delete rule <id>"`;
  pi.sendMessage({
    customType: "brains-rules",
    content: rulesHelp,
    display: true,
  });
}

async function handleInspectCommand(_value: string | undefined, controller: PiBrainsController, pi: ExtensionAPI): Promise<void> {
  const sessionId = controller.getSessionId();
  const cwd = controller.getCwd();

  // Build the gsc command
  const gscCmd = sessionId
    ? `gsc pi inspect ${sessionId}`
    : `gsc pi inspect --cwd ${cwd} --wait`;

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

  const shortcutBlock = shortcuts.length > 0
    ? `\nSplit shortcuts:\n  ${shortcuts.join("\n  ")}`
    : "";

  const content = `Split your terminal and run the following command to create a companion view:\n\n  ${gscCmd}\n${shortcutBlock}`;

  pi.sendMessage({
    customType: "brains-inspect",
    content,
    display: true,
  });
}

async function handleBuildCommand(value: string | undefined, controller: PiBrainsController, pi: ExtensionAPI): Promise<void> {
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
    pi.sendMessage({
      customType: "brains-build",
      content: help,
      display: true,
    });
    return;
  }

  const output = manifest
    ? await controller.buildBrain(manifest, { force })
    : await controller.buildAllBrains({ force });
  pi.sendMessage({
    customType: "brains-build",
    content: output || `Brain build completed${manifest ? ` for ${manifest}` : ""}`,
    display: true,
  });
}

function showAbout(pi: ExtensionAPI): void {
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
  pi.sendMessage({
    customType: "brains-about",
    content: about,
    display: true,
  });
}

function handleDeprecatedGuideCommand(value: string | undefined, pi: ExtensionAPI, controller: PiBrainsController, ctx: ExtensionContext): void {
  // Show deprecation notice
  ctx.ui.notify("/brains guide is deprecated. Use /brains checkpoint suggest on|off|status.", "warning");

  // Map to new commands
  if (value === "on") {
    controller.setGuideEnabled(true);
    ctx.ui.notify(formatCheckpointSuggestionNotice(controller), "info");
    return;
  }

  if (value === "off") {
    controller.setGuideEnabled(false);
    ctx.ui.notify("Checkpoint suggestions disabled.", "info");
    return;
  }

  if (value === "status") {
    const enabled = controller.isGuideEnabled();
    const logPath = controller.getGuideDebugLogPath();
    const status = `Checkpoint suggestions: ${enabled ? "ON" : "OFF"}${logPath ? `\nCheckpoint log: ${logPath}` : "\nCheckpoint log: unavailable until session starts"}`;
    ctx.ui.notify(status, "info");
    return;
  }

  // Toggle behavior for compatibility
  const newState = !controller.isGuideEnabled();
  controller.setGuideEnabled(newState);
  if (newState) {
    ctx.ui.notify(formatCheckpointSuggestionNotice(controller), "info");
  } else {
    ctx.ui.notify("Checkpoint suggestions disabled.", "info");
  }
}

async function handleCheckpointCommand(value: string | undefined, pi: ExtensionAPI, controller: PiBrainsController, ctx: ExtensionContext): Promise<void> {
  // /brains checkpoint suggest on|off|status
  if (value?.startsWith("suggest")) {
    const suggestValue = value.slice("suggest".length).trim();
    
    if (suggestValue === "on") {
      controller.setGuideEnabled(true);
      ctx.ui.notify(formatCheckpointSuggestionNotice(controller), "info");
      return;
    }
    
    if (suggestValue === "off") {
      controller.setGuideEnabled(false);
      ctx.ui.notify("Checkpoint suggestions disabled.", "info");
      return;
    }
    
    if (suggestValue === "status") {
      const enabled = controller.isGuideEnabled();
      const logPath = controller.getGuideDebugLogPath();
      const status = `Checkpoint suggestions: ${enabled ? "ON" : "OFF"}${logPath ? `\nCheckpoint log: ${logPath}` : "\nCheckpoint log: unavailable until session starts"}`;
      ctx.ui.notify(status, "info");
      return;
    }
    
    // Show suggest help
    ctx.ui.notify("Usage: /brains checkpoint suggest on|off|status", "info");
    return;
  }

  // /brains checkpoint - create checkpoint now
  // Update leaf ID from current session state before checkpoint
  const currentLeafId = ctx.sessionManager.getLeafId();
  controller.updateGuideLeafId(currentLeafId);

  // Get session info for the confirmation dialog
  const sessionId = controller.getSessionId();
  const pendingSuggestion = controller.getPendingSuggestion();
  const suggestionCount = controller.getSuggestionCount();
  
  // Build confirmation message
  let confirmMessage = "Pi Brains will create a checkpoint of your current work.";
  confirmMessage += "\n\nThis will:";
  confirmMessage += "\n• Create a scratch branch from your current position";
  confirmMessage += "\n• Send checkpoint instructions to the agent";
  confirmMessage += "\n• The agent will review previous checkpoints and create a new one";
  confirmMessage += "\n• Your main conversation will be restored afterward";
  
  if (suggestionCount > 0) {
    confirmMessage += `\n\n${suggestionCount} pending suggestion(s) will be consumed after success.`;
  }
  
  // Show confirmation dialog
  const confirmed = await ctx.ui.confirm(
    "Create Checkpoint",
    confirmMessage,
    { timeout: 30000 } // 30 second timeout
  );
  
  if (!confirmed) {
    ctx.ui.notify("Checkpoint cancelled.", "info");
    return;
  }

  // Write checkpoint events
  const checkpointResult = controller.requestGuideCheckpoint("manual");
  
  // Log checkpoint requested
  controller.getGuideDebugLogger().logEvent({
    type: "checkpoint_requested",
    guideEnabled: true,
    checkpointId: checkpointResult.checkpointId,
    source: "manual",
    pendingSuggestionCount: suggestionCount,
  });
  
  // Create checkpoint message on scratch branch with triggerTurn: true
  // This will trigger the LLM to create the checkpoint
  createCheckpointWithAgent(pi, ctx as unknown as ExtensionCommandContext, controller, checkpointResult).catch(() => {
    // Error is already handled inside the function
  });
  
  ctx.ui.notify("Creating checkpoint...", "info");
}

function formatCheckpointSuggestionNotice(controller: PiBrainsController): string {
  const logPath = controller.getGuideDebugLogPath();
  return [
    "Checkpoint suggestions enabled.",
    "The agent will suggest useful checkpoint moments.",
    "Run '/brains inspect' to monitor checkpoint suggestions.",
    logPath ? `Checkpoint log: ${logPath}` : "Checkpoint log: unavailable until session starts",
  ].join("\n");
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
  
  // Build the instructions
  let instructions = `# Checkpoint Creation Request\n\n`;
  instructions += `A checkpoint has been requested to capture your current work state.\n\n`;
  instructions += `## Context\n`;
  instructions += `- ${sessionInfo}\n`;
  instructions += `- ${anchorInfo}\n`;
  instructions += `- Checkpoint ID: ${checkpointId}\n\n`;
  
  instructions += `## Instructions\n\n`;
  instructions += `1. **Review previous checkpoints** (if any):\n`;
  instructions += `   \`\`\`bash\n`;
  instructions += `   gsc sessions checkpoints list --session ${sessionId || "unknown"}\n`;
  instructions += `   \`\`\`\n\n`;
  
  instructions += `2. **Create a new checkpoint** with the following information:\n`;
  instructions += `   - Problem: What were you trying to accomplish?\n`;
  instructions += `   - Reasoning: What was your thought process?\n`;
  instructions += `   - Decisions: What key decisions did you make?\n`;
  instructions += `   - Risks: What risks or uncertainties did you identify?\n`;
  instructions += `   - Files: What files did you touch?\n`;
  instructions += `   - Tools: What tools did you use?\n\n`;
  
  instructions += `3. **Create the checkpoint** using:\n`;
  instructions += `   \`\`\`bash\n`;
  instructions += `   gsc sessions checkpoints create \\\n`;
  instructions += `     --agent pi \\\n`;
  instructions += `     --session ${sessionId || "unknown"} \\\n`;
  instructions += `     --problem "<describe the problem you were solving>" \\\n`;
  instructions += `     --reasoning "<describe your reasoning>" \\\n`;
  instructions += `     --decision "<describe key decisions>" \\\n`;
  instructions += `     --risk "<describe risks or uncertainties>" \\\n`;
  instructions += `     --file "<file1>" --file "<file2>" \\\n`;
  instructions += `     --tool "<tool1>" --tool "<tool2>"\n`;
  instructions += `   \`\`\`\n\n`;
  
  instructions += `4. **Verify the checkpoint was created**:\n`;
  instructions += `   \`\`\`bash\n`;
  instructions += `   gsc sessions checkpoints show <checkpoint-id>\n`;
  instructions += `   \`\`\`\n\n`;
  
  instructions += `## Important Notes\n`;
  instructions += `- Do NOT include raw transcripts or tool output\n`;
  instructions += `- Summarize problem, reasoning, decisions, risks, files, and tools\n`;
  instructions += `- The checkpoint should be concise and code-review friendly\n`;
  instructions += `- After creating the checkpoint, inform the user of the result\n`;
  
  return instructions;
}

function showHelp(pi: ExtensionAPI): void {
  const help = `/brains commands:

  /brains              Initialize expert context (gsc experts init)
  /brains build        Build/import a Brain manifest
  /brains checkpoint   Create a review checkpoint now
  /brains checkpoint suggest on|off|status
    Ask the agent to suggest useful checkpoint moments
  /brains inspect      Show inspect view instructions
  /brains insights     Show a static inspect snapshot
  /brains rules        Show rules status and options
  /brains rules status Show recent rule decisions
  /brains debug        Toggle debug mode
  /brains debug on     Enable debug mode
  /brains debug off    Disable debug mode
  /brains debug file   Show debug log file path
  /brains about        What GitSense can do
  /brains help         This message`;
  pi.sendMessage({
    customType: "brains-help",
    content: help,
    display: true,
  });
}
