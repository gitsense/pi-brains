import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Container,
  SelectList,
  Text,
  type Component,
  type SelectItem,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  buildChatUrl,
  getChatAppStatus,
  openExternalUrl,
  type ChatAppController,
  type ChatAppStatus,
  type GscCommandResult,
} from "./chat-app.ts";

const DEFAULT_POLL_INTERVAL_MS = 1_000;

type WebInputStatus = "waiting" | "submitted" | "cancelled";

interface WebInputRequest {
  schemaVersion: number;
  sessionId: string;
  webInputId: string;
  status: WebInputStatus;
  createdAt: string;
  updatedAt: string;
  message: string;
}

interface WebInputPollResult {
  sessionId: string;
  webInput: WebInputRequest | null;
  consumed: boolean;
}

type WebInputDialogResult =
  | { kind: "submitted"; message: string }
  | { kind: "cancelled" };

export interface WebInputController extends ChatAppController {
  getSessionId(): string | null;
  sendUserMessage(message: string): void;
}

export interface WebInputCommandOptions {
  pollIntervalMs?: number;
  platform?: NodeJS.Platform;
  copyText?: (text: string) => Promise<void>;
  openUrl?: (url: string, platform: NodeJS.Platform) => Promise<void>;
}

export async function handleWebInputCommand(
  controller: WebInputController,
  ctx: ExtensionCommandContext,
  options: WebInputCommandOptions = {},
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/brains web-input is only available in the TUI", "error");
    return;
  }

  const sessionId = controller.getSessionId();
  if (!sessionId) {
    ctx.ui.notify("No active session. Start a conversation first.", "error");
    return;
  }

  let request: WebInputRequest;
  try {
    request = await createOrResumeWebInput(controller, sessionId);
  } catch (error) {
    ctx.ui.notify(formatError(error), "error");
    return;
  }

  const chatAppStatus = await getChatAppStatus(controller);
  const result = await showWebInputDialog(
    controller,
    ctx,
    request,
    chatAppStatus,
    options,
  );

  if (result.kind === "submitted") {
    controller.sendUserMessage(result.message);
  } else {
    ctx.ui.notify("Web input cancelled", "info");
  }
}

async function createOrResumeWebInput(
  controller: WebInputController,
  sessionId: string,
): Promise<WebInputRequest> {
  const createResult = await controller.runGscCommand(
    "pi",
    "sessions",
    "web-input",
    "create",
    "--session-id",
    sessionId,
  );
  if (createResult?.code === 0) {
    const created = parseWebInputPollResult(createResult.stdout);
    if (created.webInput) return created.webInput;
    throw new Error("gsc did not return the created web input request");
  }

  const pollResult = await controller.runGscCommand(
    "pi",
    "sessions",
    "web-input",
    "poll",
    "--session-id",
    sessionId,
  );
  if (pollResult?.code === 0) {
    const existing = parseWebInputPollResult(pollResult.stdout).webInput;
    if (existing && (existing.status === "waiting" || existing.status === "submitted")) {
      return existing;
    }
  }

  throw new Error(commandFailure(
    createResult,
    "Unable to create web input. Ensure gsc includes `pi sessions web-input`.",
  ));
}

async function showWebInputDialog(
  controller: WebInputController,
  ctx: ExtensionCommandContext,
  request: WebInputRequest,
  chatAppStatus: ChatAppStatus,
  options: WebInputCommandOptions,
): Promise<WebInputDialogResult> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const platform = options.platform ?? process.platform;
  const copyText = options.copyText ?? (() => Promise.reject(new Error("Clipboard access is unavailable")));
  const openUrl = options.openUrl ?? openExternalUrl;
  const chatUrl = chatAppStatus.baseUrl
    ? buildChatUrl(chatAppStatus.baseUrl, request.sessionId)
    : "";

  return ctx.ui.custom<WebInputDialogResult>((tui, theme, _keybindings, done) => {
    let finished = false;
    let cancelPending = false;
    let pollTimer: NodeJS.Timeout | undefined;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    let pollInFlight = false;
    let lastSuccessfulPollAt: number | undefined;
    let pollError: string | undefined;
    const startedAt = Date.now();
    const statusText = new Text();
    const component = buildWebInputComponent(
      tui,
      theme,
      request,
      chatAppStatus,
      chatUrl,
      statusText,
      async action => {
        if (action === "cancel") {
          await cancelWebInput();
          return;
        }
        try {
          if (action === "open") {
            await openUrl(chatUrl, platform);
            setStatus(`Opening ${chatUrl}`);
          } else if (action === "copy-url") {
            await copyText(chatUrl);
            setStatus("URL copied to clipboard");
          } else if (action === "copy-start") {
            await copyText("gsc app native start");
            setStatus("Start command copied to clipboard");
          } else if (action === "copy-install") {
            await copyText("gsc app native install");
            setStatus("Install command copied to clipboard");
          }
        } catch (error) {
          setStatus(`Action failed: ${formatError(error)}`);
        }
      },
    );

    function setStatus(message: string): void {
      statusTextMessage = message;
      renderStatus();
    }

    let statusTextMessage = "Waiting for a message from GitSense Chat…";

    function renderStatus(): void {
      const elapsed = formatDuration(Date.now() - startedAt);
      const polling = pollInFlight
          ? "checking…"
        : pollError
          ? `error — retrying (${pollError})`
          : lastSuccessfulPollAt
            ? "healthy"
            : "starting…";
      statusText.setText(theme.fg(
        "muted",
        `${statusTextMessage}\nElapsed: ${elapsed}\nPolling: ${polling}`,
      ));
      tui.requestRender();
    }

    function finish(result: WebInputDialogResult): void {
      if (finished) return;
      finished = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      done(result);
    }

    async function poll(): Promise<void> {
      if (finished || cancelPending) return;
      pollInFlight = true;
      pollError = undefined;
      renderStatus();
      const result = await controller.runGscCommand(
        "pi",
        "sessions",
        "web-input",
        "poll",
        "--session-id",
        request.sessionId,
        "--id",
        request.webInputId,
        "--consume",
      );
      pollInFlight = false;
      if (finished || cancelPending) return;

      if (result?.code === 0) {
        try {
          const state = parseWebInputPollResult(result.stdout);
          lastSuccessfulPollAt = Date.now();
          pollError = undefined;
          if (state.webInput?.status === "submitted" && state.consumed) {
            finish({ kind: "submitted", message: state.webInput.message });
            return;
          }
          if (state.webInput?.status === "cancelled" || !state.webInput) {
            finish({ kind: "cancelled" });
            return;
          }
          setStatus("Waiting for a message from GitSense Chat…");
        } catch (error) {
          pollError = `invalid response: ${formatError(error)}`;
          setStatus("Waiting for a message from GitSense Chat…");
        }
      } else {
        pollError = commandFailure(result, "Unable to poll web input");
        setStatus("Waiting for a message from GitSense Chat…");
      }

      if (!finished) {
        pollTimer = setTimeout(() => {
          void poll();
        }, pollIntervalMs);
      }
    }

    async function cancelWebInput(): Promise<void> {
      if (finished || cancelPending) return;
      cancelPending = true;
      if (pollTimer) clearTimeout(pollTimer);
      setStatus("Cancelling web input…");

      const result = await controller.runGscCommand(
        "pi",
        "sessions",
        "web-input",
        "cancel",
        "--session-id",
        request.sessionId,
        "--id",
        request.webInputId,
      );
      if (result?.code === 0) {
        finish({ kind: "cancelled" });
        return;
      }

      const finalPoll = await controller.runGscCommand(
        "pi",
        "sessions",
        "web-input",
        "poll",
        "--session-id",
        request.sessionId,
        "--id",
        request.webInputId,
        "--consume",
      );
      if (finalPoll?.code === 0) {
        try {
          const state = parseWebInputPollResult(finalPoll.stdout);
          if (state.webInput?.status === "submitted" && state.consumed) {
            finish({ kind: "submitted", message: state.webInput.message });
            return;
          }
          if (state.webInput?.status === "cancelled" || !state.webInput) {
            finish({ kind: "cancelled" });
            return;
          }
        } catch {
          // Report the cancellation error below.
        }
      }

      cancelPending = false;
      pollError = commandFailure(result, "Unable to cancel web input");
      setStatus(commandFailure(result, "Unable to cancel web input"));
      pollTimer = setTimeout(() => {
        void poll();
      }, pollIntervalMs);
    }

    renderStatus();
    heartbeatTimer = setInterval(() => {
      if (!finished) renderStatus();
    }, 1_000);
    pollTimer = setTimeout(() => {
      void poll();
    }, 0);

    return {
      ...component,
      dispose() {
        finished = true;
        if (pollTimer) clearTimeout(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        component.dispose?.();
      },
    };
  });
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

type WebInputAction = "open" | "copy-url" | "copy-start" | "copy-install" | "cancel";

function buildWebInputComponent(
  tui: TUI,
  theme: Theme,
  request: WebInputRequest,
  chatAppStatus: ChatAppStatus,
  chatUrl: string,
  statusText: Text,
  onAction: (action: WebInputAction) => Promise<void>,
): Component & { dispose?(): void } {
  const container = new Container();
  container.addChild(new Text(theme.fg("accent", theme.bold("Web input active"))));

  const explanation = [
    "Input control has been handed to GitSense Chat.",
    "Submit the next message there, or cancel to return control to the TUI.",
    "",
    `Session: ${request.sessionId}`,
  ];
  if (chatUrl) {
    explanation.push(`GitSense Chat: ${chatUrl}`);
  } else if (chatAppStatus.description) {
    explanation.push(chatAppStatus.description);
  } else {
    explanation.push("GitSense Chat status is unavailable.");
  }
  container.addChild(new Text(explanation.join("\n"), 0, 1));
  container.addChild(statusText);

  const items: SelectItem[] = [];
  if (chatUrl) {
    items.push(
      { value: "open", label: "Open GitSense Chat", description: chatUrl },
      { value: "copy-url", label: "Copy URL", description: chatUrl },
    );
  } else if (chatAppStatus.state === "stopped") {
    items.push({
      value: "copy-start",
      label: "Copy start command",
      description: "gsc app native start",
    });
  } else if (chatAppStatus.state === "not-installed") {
    items.push({
      value: "copy-install",
      label: "Copy install command",
      description: "gsc app native install",
    });
  }
  items.push({
    value: "cancel",
    label: "Cancel web input",
    description: "Return input control to the TUI",
  });

  const selectList = new SelectList(items, items.length, {
    selectedPrefix: text => theme.fg("accent", text),
    selectedText: text => theme.fg("accent", text),
    description: text => theme.fg("muted", text),
    scrollInfo: text => theme.fg("dim", text),
    noMatch: text => theme.fg("warning", text),
  });
  selectList.onSelect = item => {
    void onAction(item.value as WebInputAction);
  };
  selectList.onCancel = () => {
    void onAction("cancel");
  };
  container.addChild(selectList);
  container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"), 0, 1));

  return {
    render(width: number) {
      return container.render(width);
    },
    invalidate() {
      container.invalidate();
    },
    handleInput(data: string) {
      selectList.handleInput(data);
      tui.requestRender();
    },
  };
}

export function parseWebInputPollResult(json: string): WebInputPollResult {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value) || typeof value.session_id !== "string") {
    throw new Error("expected a web input result with session_id");
  }

  const rawRequest = value.web_input;
  if (rawRequest === null || rawRequest === undefined) {
    return {
      sessionId: value.session_id,
      webInput: null,
      consumed: value.consumed === true,
    };
  }
  if (
    !isRecord(rawRequest)
    || typeof rawRequest.schema_version !== "number"
    || typeof rawRequest.session_id !== "string"
    || typeof rawRequest.web_input_id !== "string"
    || !isWebInputStatus(rawRequest.status)
    || typeof rawRequest.created_at !== "string"
    || typeof rawRequest.updated_at !== "string"
    || (rawRequest.message !== undefined && typeof rawRequest.message !== "string")
  ) {
    throw new Error("expected a valid web_input object");
  }

  return {
    sessionId: value.session_id,
    webInput: {
      schemaVersion: rawRequest.schema_version,
      sessionId: rawRequest.session_id,
      webInputId: rawRequest.web_input_id,
      status: rawRequest.status,
      createdAt: rawRequest.created_at,
      updatedAt: rawRequest.updated_at,
      message: rawRequest.message ?? "",
    },
    consumed: value.consumed === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWebInputStatus(value: unknown): value is WebInputStatus {
  return value === "waiting" || value === "submitted" || value === "cancelled";
}

function commandFailure(result: GscCommandResult | null, fallback: string): string {
  if (!result) return fallback;
  return result.stderr.trim() || result.stdout.trim() || `${fallback} (exit ${result.code})`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
