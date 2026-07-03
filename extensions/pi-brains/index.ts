import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { loadConfig } from "./config.ts";
import { PiBrainsController } from "./controller.ts";

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

  pi.on("message_end", (_event, ctx) => {
    controller.refreshSessionState(ctx);
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

      // /brains insights - show session status
      if (command === "insights") {
        const output = await controller.runGscBrains();
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

function showHelp(pi: ExtensionAPI): void {
  const help = `/brains commands:

  /brains              Initialize expert context (gsc experts init)
  /brains build        Build/import a Brain manifest
  /brains insights     Show session status and brain data
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
