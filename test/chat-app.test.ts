import { describe, expect, it, vi } from "vitest";
import { getChatAppStatus, type ChatAppController } from "../extensions/pi-brains/chat-app.ts";

describe("GitSense Chat status", () => {
  it("keeps the configured port when native Chat is stopped", async () => {
    const controller: ChatAppController = {
      runGscCommand: vi.fn(async () => ({
        code: 0,
        stdout: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  GitSense Chat Native Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Installed:      true
  Status:         Stopped
  Port:           3357 (configured)
  Data Dir:       /Users/terrchen/gitsense-chat/data
  Log File:       /Users/terrchen/gitsense-chat/data/logs/app.log
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`,
        stderr: "",
      })),
    };

    await expect(getChatAppStatus(controller)).resolves.toEqual({
      state: "stopped",
      baseUrl: "http://127.0.0.1:3357",
      description: "GitSense Chat is not running",
    });
  });
});
