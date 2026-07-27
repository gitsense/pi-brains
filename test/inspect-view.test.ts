import { describe, expect, it } from "vitest";
import type { ChatAppStatus } from "../extensions/pi-brains/chat-app.ts";
import { buildInspectDialog } from "../extensions/pi-brains/inspect-view.ts";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const GSC_COMMAND = `gsc pi inspect ${SESSION_ID}`;

function status(
  state: ChatAppStatus["state"],
  baseUrl = "",
): ChatAppStatus {
  return { state, baseUrl, description: "" };
}

describe("inspect dialog", () => {
  it("explains terminal and browser inspection when GitSense Chat is running", () => {
    const dialog = buildInspectDialog({
      sessionId: SESSION_ID,
      gscCommand: GSC_COMMAND,
      shortcuts: ["tmux: Ctrl-b %"],
      chatAppStatus: status("running", "http://127.0.0.1:3357"),
    });

    expect(dialog.message).toContain("Inspect this session in another terminal or GitSense Chat.");
    expect(dialog.message).toContain(`Terminal:\n  ${GSC_COMMAND}`);
    expect(dialog.message).toContain("Split shortcuts:\n  tmux: Ctrl-b %");
    expect(dialog.message).toContain("GitSense Chat:\n  Running at http://127.0.0.1:3357");
    expect(dialog.message).toContain(`Session URL: http://127.0.0.1:3357/?chat=pi-${SESSION_ID}`);
    expect(dialog.options.map(option => option.action)).toEqual([
      "copy-terminal",
      "open-chat",
      "copy-chat-url",
      "close",
    ]);
  });

  it("explains how to start an installed app", () => {
    const dialog = buildInspectDialog({
      sessionId: SESSION_ID,
      gscCommand: GSC_COMMAND,
      shortcuts: [],
      chatAppStatus: status("stopped"),
    });

    expect(dialog.message).toContain("GitSense Chat:\n  Not running.");
    expect(dialog.message).toContain("Start it with: gsc app native start");
    expect(dialog.options.map(option => option.action)).toEqual([
      "copy-terminal",
      "copy-start",
      "close",
    ]);
  });

  it("explains how to install the app", () => {
    const dialog = buildInspectDialog({
      sessionId: SESSION_ID,
      gscCommand: GSC_COMMAND,
      shortcuts: [],
      chatAppStatus: status("not-installed"),
    });

    expect(dialog.message).toContain("GitSense Chat:\n  Not installed.");
    expect(dialog.message).toContain("Install it with: gsc app native install");
    expect(dialog.options.map(option => option.action)).toEqual([
      "copy-terminal",
      "copy-install",
      "close",
    ]);
  });

  it("keeps terminal inspection available when app status is unavailable", () => {
    const dialog = buildInspectDialog({
      sessionId: SESSION_ID,
      gscCommand: GSC_COMMAND,
      shortcuts: [],
      chatAppStatus: status("unavailable"),
    });

    expect(dialog.message).toContain("GitSense Chat:\n  Status unavailable.");
    expect(dialog.message).toContain("The terminal inspection command is still available.");
    expect(dialog.options.map(option => option.action)).toEqual([
      "copy-terminal",
      "close",
    ]);
  });

  it("explains the wait behavior before a Pi session is active", () => {
    const command = "gsc pi inspect --cwd '/repo' --wait";
    const dialog = buildInspectDialog({
      sessionId: null,
      gscCommand: command,
      shortcuts: [],
      chatAppStatus: status("running", "http://127.0.0.1:3357"),
    });

    expect(dialog.message).toContain(`Terminal:\n  ${command}`);
    expect(dialog.message).toContain("No active session yet; this command waits for one.");
    expect(dialog.message).toContain("Browser inspection becomes available once Pi has an active session.");
    expect(dialog.chatUrl).toBe("");
    expect(dialog.options.map(option => option.action)).toEqual([
      "copy-terminal",
      "close",
    ]);
  });
});
