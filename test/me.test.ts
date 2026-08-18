import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { formatAgentIdentity, handleMeCommand } from "../extensions/pi-brains/me.ts";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function createContext(selection = "Close", mode = "tui") {
  const notify = vi.fn();
  const select = vi.fn(async () => selection);
  const ctx = { mode, ui: { notify, select } } as unknown as ExtensionCommandContext;
  return { ctx, notify, select };
}

describe("/brains me", () => {
  it("formats the stable agent identity contract", () => {
    expect(formatAgentIdentity(SESSION_ID, 4242, true)).toBe(`${SESSION_ID}::4242::on`);
    expect(formatAgentIdentity(SESSION_ID, 4242, false)).toBe(`${SESSION_ID}::4242::off`);
  });

  it("shows and copies the exact agent identity", async () => {
    const { ctx, notify, select } = createContext("Copy agent info");
    const copy = vi.fn(async () => {});

    await handleMeCommand(
      { getSessionId: () => SESSION_ID },
      ctx,
      { autoAcceptEnabled: true, pid: 4242, copy },
    );

    const identity = `${SESSION_ID}::4242::on`;
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining(identity),
      ["Copy agent info", "Close"],
    );
    expect(copy).toHaveBeenCalledWith(identity);
    expect(notify).toHaveBeenCalledWith("Agent info copied to clipboard", "info");
  });

  it("reports when no active session is bound", async () => {
    const { ctx, notify, select } = createContext();

    await handleMeCommand(
      { getSessionId: () => null },
      ctx,
      { autoAcceptEnabled: false, pid: 4242 },
    );

    expect(select).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("No active session. Start a conversation first.", "error");
  });

  it("rejects non-TUI contexts", async () => {
    const { ctx, notify, select } = createContext("Close", "rpc");

    await handleMeCommand(
      { getSessionId: () => SESSION_ID },
      ctx,
      { autoAcceptEnabled: false, pid: 4242 },
    );

    expect(select).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("/brains me is only available in the TUI", "error");
  });
});
