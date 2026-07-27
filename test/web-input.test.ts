import type {
  ExtensionCommandContext,
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { buildChatUrl } from "../extensions/pi-brains/chat-app.ts";
import {
  handleWebInputCommand,
  parseWebInputPollResult,
  type WebInputController,
} from "../extensions/pi-brains/web-input.ts";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const WEB_INPUT_ID = "22222222-2222-4222-8222-222222222222";

function response(status: "waiting" | "submitted" | "cancelled", options?: {
  message?: string;
  consumed?: boolean;
}): string {
  return JSON.stringify({
    session_id: SESSION_ID,
    web_input: {
      schema_version: 1,
      session_id: SESSION_ID,
      web_input_id: WEB_INPUT_ID,
      status,
      created_at: "2026-07-26T10:00:00Z",
      updated_at: "2026-07-26T10:00:01Z",
      ...(options?.message === undefined ? {} : { message: options.message }),
    },
    ...(options?.consumed ? { consumed: true } : {}),
  });
}

function createContext(onComponent?: (component: Component) => void) {
  const notify = vi.fn();
  const tui = { requestRender: vi.fn() } as unknown as TUI;
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Theme;
  const custom: ExtensionUIContext["custom"] = async factory => new Promise(resolve => {
    const component = factory(
      tui,
      theme,
      {} as never,
      resolve,
    );
    if (component instanceof Promise) {
      void component.then(resolved => onComponent?.(resolved));
    } else {
      onComponent?.(component);
    }
  });
  const ctx = {
    mode: "tui",
    ui: { notify, custom },
  } as unknown as ExtensionCommandContext;
  return { ctx, notify, tui };
}

function createController(
  runGscCommand: WebInputController["runGscCommand"],
) {
  const sendUserMessage = vi.fn();
  const controller: WebInputController = {
    getSessionId: () => SESSION_ID,
    runGscCommand,
    sendUserMessage,
  };
  return { controller, sendUserMessage };
}

describe("web input", () => {
  it("creates, consumes, and sends a submitted web message", async () => {
    const runGscCommand = vi.fn(async (...args: string[]) => {
      if (args.includes("create")) {
        return { code: 0, stdout: response("waiting"), stderr: "" };
      }
      if (args[0] === "app") {
        return {
          code: 0,
          stdout: JSON.stringify({ running: true, installed: true, base_url: "http://127.0.0.1:3357" }),
          stderr: "",
        };
      }
      return {
        code: 0,
        stdout: response("submitted", { message: "Message from the web", consumed: true }),
        stderr: "",
      };
    });
    const { controller, sendUserMessage } = createController(runGscCommand);
    const { ctx } = createContext();

    await handleWebInputCommand(controller, ctx, { pollIntervalMs: 0 });

    expect(sendUserMessage).toHaveBeenCalledWith("Message from the web");
    expect(runGscCommand).toHaveBeenCalledWith(
      "pi",
      "sessions",
      "web-input",
      "poll",
      "--session-id",
      SESSION_ID,
      "--id",
      WEB_INPUT_ID,
      "--consume",
    );
  });

  it("resumes an existing request when create reports one active", async () => {
    let sessionPolls = 0;
    const runGscCommand = vi.fn(async (...args: string[]) => {
      if (args.includes("create")) {
        return { code: 1, stdout: "", stderr: "a web input request is already active" };
      }
      if (args[0] === "app") {
        return { code: 1, stdout: "", stderr: "not running" };
      }
      if (!args.includes("--id")) {
        sessionPolls += 1;
        return { code: 0, stdout: response("waiting"), stderr: "" };
      }
      return {
        code: 0,
        stdout: response("submitted", { message: "Resumed message", consumed: true }),
        stderr: "",
      };
    });
    const { controller, sendUserMessage } = createController(runGscCommand);

    await handleWebInputCommand(controller, createContext().ctx, { pollIntervalMs: 0 });

    expect(sessionPolls).toBe(1);
    expect(sendUserMessage).toHaveBeenCalledWith("Resumed message");
  });

  it("cancels the matching request when Escape is pressed", async () => {
    const runGscCommand = vi.fn(async (...args: string[]) => {
      if (args.includes("create")) {
        return { code: 0, stdout: response("waiting"), stderr: "" };
      }
      if (args[0] === "app") {
        return { code: 1, stdout: "", stderr: "" };
      }
      if (args.includes("cancel")) {
        return { code: 0, stdout: response("cancelled"), stderr: "" };
      }
      return { code: 0, stdout: response("waiting"), stderr: "" };
    });
    const { controller, sendUserMessage } = createController(runGscCommand);
    const { ctx, notify } = createContext(component => {
      component.handleInput?.("\u001b");
    });

    await handleWebInputCommand(controller, ctx, { pollIntervalMs: 0 });

    expect(runGscCommand).toHaveBeenCalledWith(
      "pi",
      "sessions",
      "web-input",
      "cancel",
      "--session-id",
      SESSION_ID,
      "--id",
      WEB_INPUT_ID,
    );
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Web input cancelled", "info");
  });

  it("delivers a message that wins the cancellation race", async () => {
    const runGscCommand = vi.fn(async (...args: string[]) => {
      if (args.includes("create")) {
        return { code: 0, stdout: response("waiting"), stderr: "" };
      }
      if (args[0] === "app") {
        return { code: 1, stdout: "", stderr: "" };
      }
      if (args.includes("cancel")) {
        return {
          code: 1,
          stdout: "",
          stderr: `cannot transition web input request ${WEB_INPUT_ID} from submitted to cancelled`,
        };
      }
      return {
        code: 0,
        stdout: response("submitted", { message: "Won the race", consumed: true }),
        stderr: "",
      };
    });
    const { controller, sendUserMessage } = createController(runGscCommand);
    const { ctx } = createContext(component => {
      component.handleInput?.("\u001b");
    });

    await handleWebInputCommand(controller, ctx, { pollIntervalMs: 0 });

    expect(sendUserMessage).toHaveBeenCalledWith("Won the race");
  });

  it("updates elapsed time and poll health while waiting", async () => {
    vi.useFakeTimers();
    try {
      const runGscCommand = vi.fn(async (...args: string[]) => {
        if (args.includes("create")) {
          return { code: 0, stdout: response("waiting"), stderr: "" };
        }
        if (args[0] === "app") {
          return { code: 1, stdout: "", stderr: "" };
        }
        if (args.includes("cancel")) {
          return { code: 0, stdout: response("cancelled"), stderr: "" };
        }
        return { code: 0, stdout: response("waiting"), stderr: "" };
      });
      const { controller } = createController(runGscCommand);
      let component: Component | undefined;
      const { ctx, tui } = createContext(value => {
        component = value;
      });
      const command = handleWebInputCommand(controller, ctx);

      await vi.advanceTimersByTimeAsync(1_500);
      const rendered = component?.render(120).join("\n") ?? "";
      expect(rendered).toContain("Elapsed:");
      expect(rendered).toContain("Polling: healthy");
      expect(tui.requestRender).toHaveBeenCalled();

      component?.handleInput?.("\u001b");
      await command;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects malformed gsc responses", () => {
    expect(() => parseWebInputPollResult('{"session_id":"session","web_input":{}}'))
      .toThrow("expected a valid web_input object");
  });

  it("requires an active TUI session", async () => {
    const runGscCommand = vi.fn();
    const { controller, sendUserMessage } = createController(runGscCommand);
    const { ctx, notify } = createContext();
    Object.assign(ctx, { mode: "rpc" });

    await handleWebInputCommand(controller, ctx);

    expect(runGscCommand).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("/brains web-input is only available in the TUI", "error");
  });
});

describe("GitSense Chat URL", () => {
  it("uses the Pi session chat identifier", () => {
    expect(buildChatUrl("http://127.0.0.1:3357/base", SESSION_ID))
      .toBe(`http://127.0.0.1:3357/?chat=pi-${SESSION_ID}`);
  });
});
