import { describe, expect, it } from "vitest";
import type { ChatAppStatus } from "../extensions/pi-brains/chat-app.ts";
import { buildSearchDialog } from "../extensions/pi-brains/search-view.ts";

function status(state: ChatAppStatus["state"], baseUrl = ""): ChatAppStatus {
  return { state, baseUrl, description: "" };
}

describe("search view", () => {
  it("offers the search URL and start command while Chat is stopped", () => {
    const dialog = buildSearchDialog(status("stopped", "http://127.0.0.1:3357"));

    expect(dialog.chatUrl).toBe("http://127.0.0.1:3357/?chat=pi-sessions&tab=search");
    expect(dialog.message).toContain("Search URL: http://127.0.0.1:3357/?chat=pi-sessions&tab=search");
    expect(dialog.options.map(option => option.action)).toEqual([
      "open-chat",
      "copy-chat-url",
      "copy-start",
      "close",
    ]);
  });

  it("offers the search URL while Chat is running", () => {
    const dialog = buildSearchDialog(status("running", "http://localhost:3357"));

    expect(dialog.chatUrl).toBe("http://localhost:3357/?chat=pi-sessions&tab=search");
    expect(dialog.options.map(option => option.action)).toEqual([
      "open-chat",
      "copy-chat-url",
      "close",
    ]);
  });

  it("offers install help when Chat is not installed", () => {
    const dialog = buildSearchDialog(status("not-installed"));

    expect(dialog.message).toContain("Install it with: gsc app native install");
    expect(dialog.options.map(option => option.action)).toEqual(["copy-install", "close"]);
  });
});
