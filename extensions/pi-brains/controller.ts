import type { AgentEndEvent, AgentStartEvent, BeforeAgentStartEvent, BeforeAgentStartEventResult, ContextEvent, ExtensionAPI, ExtensionContext, InputEvent, InputEventResult, SessionBeforeCompactEvent, SessionCompactEvent, ToolCallEvent, ToolCallEventResult, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, OverlayOptions, TUI } from "@earendil-works/pi-tui";
import { GSC_MISSING_NOTICE_ID, saveConfig } from "./config.ts";
import { DebugLogger } from "./debug.ts";
import { readContextState, readModelState } from "./model-context.ts";
import { BrainsPanel } from "./panel.ts";
import { RepositoryResolver } from "./repositories.ts";
import { RuleDeliveryTracker } from "./rules/delivery.ts";
import { RuleEngine } from "./rules/engine.ts";
import { GscRulesClient } from "./rules/gsc-client.ts";
import { TouchedFileTracker } from "./touched-files.ts";
import type { PanelState, PiBrainsConfig } from "./types.ts";

const OVERLAY_OWNER_WIDGET = "pi-brains-overlay-owner";
type NoticeLevel = Parameters<ExtensionContext["ui"]["notify"]>[1];
const GITSENSE_SYSTEM_PROMPT = `GitSense / pi-brains context:
- GitSense is available through the gsc CLI.
- pi-brains evaluates GitSense rules for Pi lifecycle events.
- Brains are local manifest databases. Before using a Brain, check availability with: gsc brains --json
- If the requested Brain is not available, do not pretend it exists. Tell the user it must be built first and suggest: /brains build <brain-name>
- Do not build Brains automatically unless the user explicitly asks. Building a Brain can write .gitsense files and may take time.
- To build/import a Brain manifest manually, run: gsc manifest import <brain-name-or-manifest-path-or-url>
- Rules live in .gitsense/rules/records.jsonl; executable trigger files live in .gitsense/rules/triggers/.
- "Trigger rules" means GitSense tool-trigger rules: executable rules with trigger code, instruction text/query, frequency, and lifecycle event.
- To inspect a rule, run: gsc rules show <rule-id>
- To learn rule syntax, run: gsc experts guide rules
- For executable triggers, run: gsc experts guide triggers or gsc experts guide trigger-creation`;

export class PiBrainsController {
  private readonly pi: ExtensionAPI;
  private readonly config: PiBrainsConfig;
  private readonly tracker = new TouchedFileTracker();
  private readonly repositories: RepositoryResolver;
  private readonly backgroundAbort = new AbortController();
  private readonly rulesDelivery = new RuleDeliveryTracker();
  private readonly rulesEngine: RuleEngine;
  private readonly debug: DebugLogger;
  private context: PanelState["context"] = null;
  private model: PanelState["model"] = null;
  private gscStatus: PanelState["gscStatus"] = "checking";
  private cwd = "";
  private tui: TUI | null = null;
  private overlayHandle: OverlayHandle | null = null;
  private overlayOptions: OverlayOptions | null = null;
  private clearOverlayOwner: (() => void) | null = null;
  private disposed = false;
  private passiveSteerBuffer: string[] = [];
  private passiveSteerMaxLength = 5;
  private passiveSteerMaxChars = 2000;

  constructor(pi: ExtensionAPI, config: PiBrainsConfig) {
    this.pi = pi;
    this.config = config;
    this.debug = new DebugLogger(() => this.config);
    this.repositories = new RepositoryResolver(pi);
    this.rulesEngine = new RuleEngine(
      new GscRulesClient(pi, this.backgroundAbort.signal, this.debug),
      this.rulesDelivery,
      () => this.pi.getThinkingLevel(),
      this.debug
    );
  }

  start(ctx: ExtensionContext): void {
    this.cwd = ctx.cwd;
    this.tracker.replay(ctx.sessionManager.getBranch(), ctx.cwd);
    this.refreshSessionState(ctx);
    this.repositories.resolveFiles(this.tracker.getFiles(), () => this.requestRender());
    this.config.visible = false;

    // Disable debug on session start (debug is session-only)
    if (this.config.debug) {
      this.debug.log("Disabling debug mode on session start");
      this.config.debug = false;
      void this.persistConfig();
    }

    // Refresh context after compaction
    this.pi.on("session_compact", () => {
      this.refreshSessionState(ctx);
    });

    ctx.ui.setWidget(OVERLAY_OWNER_WIDGET, (tui, theme) => {
      this.tui = tui;
      this.overlayOptions = {
        anchor: "top-right",
        width: this.config.width,
        maxHeight: "100%",
        nonCapturing: true,
        visible: (terminalWidth) => terminalWidth >= this.config.minTerminalWidth,
      };
      this.overlayHandle = tui.showOverlay(
        new BrainsPanel(() => this.getState(), () => this.getConfig(), theme),
        this.overlayOptions,
      );
      this.overlayHandle.setHidden(true);
      return new OverlayOwner(() => this.releaseOverlay());
    });
    this.clearOverlayOwner = () => ctx.ui.setWidget(OVERLAY_OWNER_WIDGET, undefined);

    void this.detectGsc();
  }

  refreshSessionState(ctx: ExtensionContext): void {
    this.context = readContextState(ctx);
    this.model = readModelState(this.pi, ctx);
    this.requestRender();
  }

  recordToolResult(event: ToolResultEvent, ctx: ExtensionContext): void {
    const changed = this.tracker.recordResult(event, ctx.cwd);
    if (changed) this.repositories.resolveFiles(this.tracker.getFiles(), () => this.requestRender());
    if (changed || event.toolName === "bash") this.requestRender();
  }

  async handleToolResult(event: ToolResultEvent, ctx: ExtensionContext): Promise<void> {
    if (!this.config.rulesEnabled) {
      this.debug.log("rules disabled, skipping tool result");
      return;
    }

    this.debug.log(`evaluating rules for tool result: toolName=${event.toolName}, isError=${event.isError}`);

    // Use new gsc rules execute flow
    const result = await this.rulesEngine.evaluateWithExecute(event, ctx, this.config.debug);

    if (!result) {
      this.debug.log(`no result from tool result evaluation`);
      return;
    }

    this.debug.log(`tool result result: block=${result.block}, notices=${result.notices?.length ?? 0}`);

    // Show notices
    for (const notice of result.notices ?? []) {
      this.debug.log(`showing notice: ${notice}`);
      ctx.ui.notify(notice, "info");
    }

    // Show trigger error notices (fail-open)
    for (const error of result.errors ?? []) {
      this.debug.log(`trigger error: ${error.ruleId} - ${error.error}`);
      ctx.ui.notify(`Trigger error (${error.ruleId}): ${error.error} - Action proceeding (fail-open)`, "warning");
    }

    // Send messages from trigger results
    for (const triggerResult of result.triggerResults ?? []) {
      if (triggerResult.notice) {
        this.debug.log(`trigger notice: ${triggerResult.notice}`);
        this.notifyTriggerNotice(ctx, triggerResult.notice, triggerResult.level);
      }
      if (triggerResult.message) {
        this.debug.log(`trigger message: ${triggerResult.message}`);
        this.sendTriggerMessage(triggerResult.message, triggerResult.deliveryMode, ctx);
      }
    }
  }

  async handleStop(event: AgentEndEvent, ctx: ExtensionContext): Promise<void> {
    if (!this.config.rulesEnabled) {
      this.debug.log("rules disabled, skipping agent_end");
      return;
    }

    this.debug.log(`evaluating rules for agent_end event: ${event.messages.length} messages`);

    // Clear passiveSteer buffer (agent is ending)
    this.clearPassiveSteerBuffer();

    // Use new gsc rules execute flow
    const result = await this.rulesEngine.evaluateWithExecute(event, ctx, this.config.debug);

    if (!result) {
      this.debug.log(`no result from agent_end evaluation`);
      return;
    }

    this.debug.log(`agent_end result: block=${result.block}, notices=${result.notices?.length ?? 0}`);

    // Show notices
    for (const notice of result.notices ?? []) {
      this.debug.log(`showing notice: ${notice}`);
      ctx.ui.notify(notice, "info");
    }

    // Show trigger error notices (fail-open)
    for (const error of result.errors ?? []) {
      this.debug.log(`trigger error: ${error.ruleId} - ${error.error}`);
      ctx.ui.notify(`Trigger error (${error.ruleId}): ${error.error} - Action proceeding (fail-open)`, "warning");
    }

    // Send messages from trigger results
    for (const triggerResult of result.triggerResults ?? []) {
      if (triggerResult.notice) {
        this.debug.log(`trigger notice: ${triggerResult.notice}`);
        this.notifyTriggerNotice(ctx, triggerResult.notice, triggerResult.level);
      }
      if (triggerResult.message) {
        this.debug.log(`trigger message: ${triggerResult.message}`);
        this.sendTriggerMessage(triggerResult.message, triggerResult.deliveryMode, ctx);
      }
    }
  }

  async handleAgentStart(event: AgentStartEvent, ctx: ExtensionContext): Promise<void> {
    if (!this.config.rulesEnabled) {
      this.debug.log("rules disabled, skipping agent_start");
      return;
    }

    this.debug.log("evaluating rules for agent_start event");

    // Use new gsc rules execute flow
    const result = await this.rulesEngine.evaluateWithExecute(event, ctx, this.config.debug);

    if (!result) {
      this.debug.log(`no result from agent_start evaluation`);
      return;
    }

    this.debug.log(`agent_start result: block=${result.block}, notices=${result.notices?.length ?? 0}`);

    // Show notices
    for (const notice of result.notices ?? []) {
      this.debug.log(`showing notice: ${notice}`);
      ctx.ui.notify(notice, "info");
    }

    // Send messages from trigger results
    for (const triggerResult of result.triggerResults ?? []) {
      if (triggerResult.notice) {
        this.debug.log(`trigger notice: ${triggerResult.notice}`);
        this.notifyTriggerNotice(ctx, triggerResult.notice, triggerResult.level);
      }
      if (triggerResult.message) {
        this.debug.log(`trigger message: ${triggerResult.message}`);
        this.sendTriggerMessage(triggerResult.message, triggerResult.deliveryMode, ctx);
      }
    }
  }

  async handleContext(event: ContextEvent, ctx: ExtensionContext): Promise<any> {
    if (!this.config.rulesEnabled) {
      this.debug.log("rules disabled, skipping context");
      return undefined;
    }

    this.debug.log("evaluating rules for context event");

    // Drain buffered passiveSteer messages
    const passive = this.drainPassiveSteerBuffer();

    // Use new gsc rules execute flow
    const result = await this.rulesEngine.evaluateWithExecute(event, ctx, this.config.debug);

    // Show notices from rules
    if (result) {
      for (const notice of result.notices ?? []) {
        this.debug.log(`showing notice: ${notice}`);
        ctx.ui.notify(notice, "info");
      }

      // Handle trigger results
      for (const triggerResult of result.triggerResults ?? []) {
        if (triggerResult.notice) {
          this.debug.log(`trigger notice: ${triggerResult.notice}`);
          this.notifyTriggerNotice(ctx, triggerResult.notice, triggerResult.level);
        }
        if (triggerResult.message) {
          this.debug.log(`trigger message: ${triggerResult.message}`);
          this.sendTriggerMessage(triggerResult.message, triggerResult.deliveryMode, ctx);
        }
      }
    }

    // Inject passiveSteer messages into context
    if (passive.length > 0) {
      const guidance = [
        "Passive repository guidance for the next action:",
        "",
        ...passive.map((message) => `- ${message}`),
      ].join("\n");

      this.debug.log(`injecting passiveSteer context: ${passive.length} messages`);

      return {
        messages: [
          ...event.messages,
          {
            role: "user",
            content: [
              {
                type: "text",
                text: guidance,
              },
            ],
          },
        ],
      };
    }

    return undefined;
  }

  async handleSessionBeforeCompact(event: SessionBeforeCompactEvent, ctx: ExtensionContext): Promise<void> {
    if (!this.config.rulesEnabled) {
      this.debug.log("rules disabled, skipping session_before_compact");
      return;
    }

    this.debug.log("evaluating rules for session_before_compact event");

    // Use new gsc rules execute flow
    const result = await this.rulesEngine.evaluateWithExecute(event, ctx, this.config.debug);

    if (!result) {
      this.debug.log(`no result from session_before_compact evaluation`);
      return;
    }

    this.debug.log(`session_before_compact result: block=${result.block}, notices=${result.notices?.length ?? 0}`);

    // Show notices
    for (const notice of result.notices ?? []) {
      this.debug.log(`showing notice: ${notice}`);
      ctx.ui.notify(notice, "info");
    }

    // Send messages from trigger results
    for (const triggerResult of result.triggerResults ?? []) {
      if (triggerResult.notice) {
        this.debug.log(`trigger notice: ${triggerResult.notice}`);
        this.notifyTriggerNotice(ctx, triggerResult.notice, triggerResult.level);
      }
      if (triggerResult.message) {
        this.debug.log(`trigger message: ${triggerResult.message}`);
        this.sendTriggerMessage(triggerResult.message, triggerResult.deliveryMode, ctx);
      }
    }
  }

  async handleSessionCompact(event: SessionCompactEvent, ctx: ExtensionContext): Promise<void> {
    if (!this.config.rulesEnabled) {
      this.debug.log("rules disabled, skipping session_compact");
      return;
    }

    this.debug.log("evaluating rules for session_compact event");

    // Use new gsc rules execute flow
    const result = await this.rulesEngine.evaluateWithExecute(event, ctx, this.config.debug);

    if (!result) {
      this.debug.log(`no result from session_compact evaluation`);
      return;
    }

    this.debug.log(`session_compact result: block=${result.block}, notices=${result.notices?.length ?? 0}`);

    // Show notices
    for (const notice of result.notices ?? []) {
      this.debug.log(`showing notice: ${notice}`);
      ctx.ui.notify(notice, "info");
    }

    // Send messages from trigger results
    for (const triggerResult of result.triggerResults ?? []) {
      if (triggerResult.notice) {
        this.debug.log(`trigger notice: ${triggerResult.notice}`);
        this.notifyTriggerNotice(ctx, triggerResult.notice, triggerResult.level);
      }
      if (triggerResult.message) {
        this.debug.log(`trigger message: ${triggerResult.message}`);
        this.sendTriggerMessage(triggerResult.message, triggerResult.deliveryMode, ctx);
      }
    }
  }

  async handleToolCall(event: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | undefined> {
    if (!this.config.rulesEnabled) return undefined;

    // Use new gsc rules execute flow
    const result = await this.rulesEngine.evaluateWithExecute(event, ctx, this.config.debug);

    if (!result) {
      this.debug.log(`no result from tool call evaluation`);
      return undefined;
    }

    this.debug.log(`tool call result: block=${result.block}, notices=${result.notices?.length ?? 0}`);

    // Show notices
    for (const notice of result.notices ?? []) {
      ctx.ui.notify(notice, "warning");
    }

    // Show trigger error notices (fail-open)
    for (const error of result.errors ?? []) {
      this.debug.log(`trigger error: ${error.ruleId} - ${error.error}`);
      ctx.ui.notify(`Trigger error (${error.ruleId}): ${error.error} - Action proceeding (fail-open)`, "warning");
    }

    if (!result.block) return undefined;
    return { block: true, reason: result.reason };
  }

  async handleInput(event: InputEvent, ctx: ExtensionContext): Promise<InputEventResult | undefined> {
    if (!this.config.rulesEnabled) {
      this.debug.log("rules disabled, skipping");
      return undefined;
    }

    this.debug.log(`evaluating rules for input event: text="${event.text}"`);

    // Use new gsc rules execute flow
    const result = await this.rulesEngine.evaluateWithExecute(event, ctx, this.config.debug);

    if (!result) {
      this.debug.log(`no result from input evaluation`);
      return undefined;
    }

    this.debug.log(`input result: block=${result.block}, notices=${result.notices?.length ?? 0}`);

    // Show notices
    const notices = result.notices ?? [];
    for (const notice of notices) {
      ctx.ui.notify(notice, "warning");
    }

    // Show trigger error notices (fail-open)
    for (const error of result.errors ?? []) {
      this.debug.log(`trigger error: ${error.ruleId} - ${error.error}`);
      ctx.ui.notify(`Trigger error (${error.ruleId}): ${error.error} - Action proceeding (fail-open)`, "warning");
    }

    if (!result.block) return undefined;

    // Only show generic block message when no specific notices were shown
    if (notices.length === 0) {
      ctx.ui.notify("Input blocked by GitSense rule", "warning");
    }
    return { action: "handled" };
  }

  async handleBeforeAgentStart(event: BeforeAgentStartEvent, ctx: ExtensionContext): Promise<BeforeAgentStartEventResult | undefined> {
    const eventResult: BeforeAgentStartEventResult = {
      systemPrompt: `${event.systemPrompt}\n\n${GITSENSE_SYSTEM_PROMPT}`,
    };

    if (!this.config.rulesEnabled) return eventResult;
    this.debug.log("evaluating rules for before_agent_start event");

    // Use new gsc rules execute flow
    const result = await this.rulesEngine.evaluateWithExecute(event, ctx, this.config.debug);

    if (!result) {
      this.debug.log(`no result from before_agent_start evaluation`);
      return eventResult;
    }

    this.debug.log(`before_agent_start result: block=${result.block}, notices=${result.notices?.length ?? 0}`);

    // Show notices
    for (const notice of result.notices ?? []) {
      this.debug.log(`showing notice: ${notice}`);
      ctx.ui.notify(notice, "info");
    }

    // Inject matched rules as message if present
    if (result.matchedRules && result.matchedRules.length > 0) {
      const instructions = result.matchedRules
        .filter(r => r.instructions && r.instructions.length > 0)
        .flatMap(r => r.instructions!);
      
      if (instructions.length > 0) {
        this.debug.log(`injecting instructions: ${instructions.join("; ")}`);
        eventResult.message = {
          customType: "brains-context",
          content: instructions.join("\n"),
          display: true,
        };
      }
    }

    return eventResult;
  }

  setRulesEnabled(enabled: boolean): void {
    this.config.rulesEnabled = enabled;
    void this.persistConfig();
  }

  isRulesEnabled(): boolean {
    return this.config.rulesEnabled;
  }

  setDebug(enabled: boolean): void {
    this.config.debug = enabled;
    void this.persistConfig();
  }

  isDebug(): boolean {
    return this.config.debug;
  }

  getDebugLogFilePath(): string {
    return this.debug.getLogFilePath();
  }

  getRulesStatus(): string {
    return this.rulesDelivery.formatStatus();
  }

  sendUserMessage(message: string): void {
    this.pi.sendUserMessage(message);
  }

  private notifyTriggerNotice(ctx: ExtensionContext, notice: string, level: string | undefined): void {
    ctx.ui.notify(notice, this.normalizeNoticeLevel(level));
  }

  private normalizeNoticeLevel(level: string | undefined): NoticeLevel {
    switch (level) {
      case "warning":
      case "error":
        return level;
      case "info":
      default:
        return "info";
    }
  }

  private sendTriggerMessage(message: string, deliveryMode: string | undefined, ctx: ExtensionContext): void {
    switch (deliveryMode) {
      case "passiveSteer":
        // Buffer the message for injection on next context event
        this.bufferPassiveSteer(message);
        break;
      case "followUp":
        this.debug.log(`sending followUp message: ${message}`);
        this.pi.sendUserMessage(message, { deliverAs: "followUp" });
        break;
      case "steer":
      default:
        this.debug.log(`sending steer message: ${message}`);
        this.pi.sendUserMessage(message, { deliverAs: "steer" });
        break;
    }
  }

  private bufferPassiveSteer(message: string): void {
    // Dedupe: skip if already in buffer
    if (this.passiveSteerBuffer.includes(message)) {
      this.debug.log(`passiveSteer deduped: ${message}`);
      return;
    }

    // Cap buffer size
    if (this.passiveSteerBuffer.length >= this.passiveSteerMaxLength) {
      this.debug.log(`passiveSteer buffer full, dropping oldest message`);
      this.passiveSteerBuffer.shift();
    }

    // Cap total characters
    const totalChars = this.passiveSteerBuffer.reduce((sum, m) => sum + m.length, 0) + message.length;
    if (totalChars > this.passiveSteerMaxChars) {
      this.debug.log(`passiveSteer buffer char limit reached, dropping oldest message`);
      this.passiveSteerBuffer.shift();
    }

    this.passiveSteerBuffer.push(message);
    this.debug.log(`buffered passiveSteer message (${this.passiveSteerBuffer.length} in buffer): ${message}`);
  }

  private drainPassiveSteerBuffer(): string[] {
    if (this.passiveSteerBuffer.length === 0) return [];

    const messages = [...this.passiveSteerBuffer];
    this.passiveSteerBuffer = [];
    this.debug.log(`draining passiveSteer buffer: ${messages.length} messages`);

    return messages;
  }

  private clearPassiveSteerBuffer(): void {
    if (this.passiveSteerBuffer.length > 0) {
      this.debug.log(`clearing passiveSteer buffer: ${this.passiveSteerBuffer.length} messages`);
      this.passiveSteerBuffer = [];
    }
  }

  getState(): PanelState {
    return {
      context: this.context,
      model: this.model,
      repositories: this.repositories.getRepositories(this.cwd),
      outsideRepositoryCount: this.repositories.getOutsideRepositoryCount(),
      trackedFileCount: this.tracker.getFiles().size,
      shellActivityObserved: this.tracker.hasShellActivity(),
      gscStatus: this.gscStatus,
    };
  }

  getConfig(): PiBrainsConfig {
    return this.config;
  }

  async dismissNotice(): Promise<void> {
    if (!this.config.dismissedNotices.includes(GSC_MISSING_NOTICE_ID)) {
      this.config.dismissedNotices.push(GSC_MISSING_NOTICE_ID);
      this.requestRender();
      await this.persistConfig();
    }
  }

  getDebugState(): Record<string, unknown> {
    const files = this.tracker.getFiles();
    const fileRoots: Record<string, string | null> = {};
    for (const [file, root] of this.repositories.getFileRoots()) {
      fileRoots[file] = root;
    }
    return {
      cwd: this.cwd,
      trackedFiles: [...files],
      fileRoots,
      outsideCount: this.repositories.getOutsideRepositoryCount(),
      repositories: this.repositories.getRepositories(this.cwd),
    };
  }

  getGscStatus(): "checking" | "available" | "missing" {
    return this.gscStatus;
  }

  hasRunExpertsInit(ctx: ExtensionContext): boolean {
    const entries = ctx.sessionManager.getBranch();

    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const msg = entry.message;

      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          // Check for bash tool call with gsc experts init
          if (block.type === "toolCall" && block.name === "bash") {
            const command = block.arguments?.command;
            if (typeof command === "string" && command.includes("gsc experts init")) {
              return true;
            }
          }

          // Check for read tool call with experts-context.md
          if (block.type === "toolCall" && block.name === "read") {
            const path = block.arguments?.path;
            if (typeof path === "string" && path.includes("experts-context.md")) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  async runGscBrains(): Promise<string> {
    try {
      this.debug.log("gsc pi -b");
      const result = await this.pi.exec("gsc", ["pi", "-b"], {
        signal: this.backgroundAbort.signal,
        timeout: 5_000,
      });
      if (this.disposed) return "";
      return result.stdout || "";
    } catch {
      if (this.disposed) return "";
      return "Error running gsc pi -b";
    }
  }

  async buildBrain(uri: string, options?: { force?: boolean }): Promise<string> {
    const args = ["manifest", "import", uri];
    if (options?.force) args.push("--force");

    try {
      this.debug.log(`gsc ${args.join(" ")}`);
      const result = await this.pi.exec("gsc", args, {
        signal: this.backgroundAbort.signal,
        timeout: 120_000,
      });
      if (this.disposed) return "";

      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      if (result.code === 0) {
        return output || `Brain built from ${uri}`;
      }
      return output || `gsc manifest import failed with exit code ${result.code}`;
    } catch (error) {
      if (this.disposed) return "";
      return error instanceof Error ? error.message : "Error building Brain";
    }
  }

  async queryBrainForFiles(brain: string, field: string): Promise<Map<string, string>> {
    const files = this.tracker.getFiles();
    const results = new Map<string, string>();

    for (const file of files) {
      try {
        this.debug.log(`gsc query --db ${brain} --glob ${file} --fields ${field}`);
        const result = await this.pi.exec("gsc", [
          "query",
          "--db",
          brain,
          "--glob",
          file,
          "--fields",
          field,
          "--format",
          "json",
          "--limit",
          "1",
        ], {
          signal: this.backgroundAbort.signal,
          timeout: 3_000,
        });

        if (this.disposed) return results;

        if (result.code === 0 && result.stdout) {
          try {
            const parsed = JSON.parse(result.stdout);
            if (parsed.results && parsed.results.length > 0) {
              const value = parsed.results[0].metadata?.[field];
              if (value && typeof value === "string") {
                results.set(file, value);
              }
            }
          } catch {
            // JSON parse error, skip
          }
        }
      } catch {
        // Command failed, skip
      }
    }

    return results;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.backgroundAbort.abort();
    this.repositories.dispose();
    this.clearOverlayOwner?.();
    this.clearOverlayOwner = null;
    this.releaseOverlay();
  }

  private requestRender(): void {
    if (!this.disposed) this.tui?.requestRender();
  }

  private releaseOverlay(): void {
    this.overlayHandle?.hide();
    this.overlayHandle = null;
    this.overlayOptions = null;
    this.tui = null;
  }

  private async detectGsc(): Promise<void> {
    try {
      this.debug.log("gsc --version");
      const result = await this.pi.exec("gsc", ["--version"], {
        signal: this.backgroundAbort.signal,
        timeout: 2_000,
      });
      if (this.disposed) return;
      this.gscStatus = result.code === 0 ? "available" : "missing";
    } catch {
      if (this.disposed) return;
      this.gscStatus = "missing";
    }
    this.requestRender();
  }

  private async persistConfig(): Promise<void> {
    try {
      await saveConfig(this.config);
    } catch {
      // Runtime state remains usable when persistence is unavailable.
    }
  }
}

class OverlayOwner implements Component {
  private readonly onDispose: () => void;

  constructor(onDispose: () => void) {
    this.onDispose = onDispose;
  }

  render(): string[] {
    return [];
  }

  invalidate(): void {}

  dispose(): void {
    this.onDispose();
  }
}
