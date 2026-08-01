import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  appendBrainsInsightsEntry,
  registerBrainsInsightsEntryRenderer,
} from "../extensions/pi-brains/insights-entry.ts";

describe("brains insights entry", () => {
  it("registers a durable custom-entry renderer", () => {
    const registerEntryRenderer = vi.fn();
    const pi = { registerEntryRenderer } as unknown as ExtensionAPI;

    registerBrainsInsightsEntryRenderer(pi);

    expect(registerEntryRenderer).toHaveBeenCalledWith("brains-insights", expect.any(Function));
  });

  it("appends the Markdown snapshot without sending a message", () => {
    const appendEntry = vi.fn();
    const pi = { appendEntry } as unknown as ExtensionAPI;

    appendBrainsInsightsEntry(pi, "## Review first\n\n- Run the tests");

    expect(appendEntry).toHaveBeenCalledWith("brains-insights", {
      title: "Brains Insights",
      markdown: "## Review first\n\n- Run the tests",
      createdAt: expect.any(Number),
    });
  });
});
