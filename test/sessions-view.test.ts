import { describe, expect, it } from "vitest";
import type { ChatAppStatus } from "../extensions/pi-brains/chat-app.ts";
import { buildSessionsDialog } from "../extensions/pi-brains/sessions-view.ts";

function status(state: ChatAppStatus["state"], baseUrl = ""): ChatAppStatus {
  return { state, baseUrl, description: "" };
}

describe("sessions view", () => {
  it("offers the sessions URL and start command while Chat is stopped", () => {
    const dialog = buildSessionsDialog(status("stopped", "http://127.0.0.1:3357"));

    expect(dialog.chatUrl).toBe("http://127.0.0.1:3357/?chat=pi-sessions");
    expect(dialog.message).toContain("Sessions URL: http://127.0.0.1:3357/?chat=pi-sessions");
    expect(dialog.options.map(option => option.action)).toEqual([
      "open-chat",
      "copy-chat-url",
      "copy-start",
      "close",
    ]);
  });

  it("offers the sessions URL while Chat is running", () => {
    const dialog = buildSessionsDialog(status("running", "http://127.0.0.1:3357"));

    expect(dialog.options.map(option => option.action)).toEqual([
      "open-chat",
      "copy-chat-url",
      "close",
    ]);
  });

  it("offers install help when Chat is not installed", () => {
    const dialog = buildSessionsDialog(status("not-installed"));

    expect(dialog.message).toContain("Install it with: gsc app native install");
    expect(dialog.options.map(option => option.action)).toEqual(["copy-install", "close"]);
  });
});
