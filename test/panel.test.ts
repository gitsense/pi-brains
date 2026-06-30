import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/pi-brains/config.ts";
import { BrainsPanel } from "../extensions/pi-brains/panel.ts";
import type { PanelState } from "../extensions/pi-brains/types.ts";

const theme = {
  fg: (_color: string, text: string) => text,
} as unknown as Theme;

describe("brains panel", () => {
  it("renders useful data first and limitations last", () => {
    const state: PanelState = {
      context: { tokens: 20_000, contextWindow: 128_000, percent: 15.625 },
      model: { id: "claude-opus-4-6", provider: "anthropic", thinkingLevel: "high" },
      repositories: [{ root: "/repo", fileCount: 12, isInitialCwd: true, files: ["/repo/src/a.ts", "/repo/src/b.ts", "/repo/src/components/Button.tsx"] }],
      outsideRepositoryCount: 0,
      trackedFileCount: 12,
      shellActivityObserved: true,
      gscStatus: "missing",
    };
    const panel = new BrainsPanel(() => state, () => ({ ...DEFAULT_CONFIG, visible: true }), theme);
    const lines = panel.render(38);

    expect(lines.some((line) => line.includes("20K / 128K · 16%"))).toBe(true);
    expect(lines.some((line) => line.includes("claude-opus-4-6"))).toBe(true);
    expect(lines.some((line) => line.includes("· 12"))).toBe(true);
    expect(lines.findIndex((line) => line.includes("DATA COVERAGE"))).toBeGreaterThan(
      lines.findIndex((line) => line.includes("FILES TRACKED")),
    );
    expect(lines.some((line) => line.includes("gsc not installed · no history"))).toBe(true);
  });

  it("renders nullable context as computing", () => {
    const state: PanelState = {
      context: { tokens: null, contextWindow: 128_000, percent: null },
      model: null,
      repositories: [],
      outsideRepositoryCount: 0,
      trackedFileCount: 0,
      shellActivityObserved: false,
      gscStatus: "available",
    };
    const panel = new BrainsPanel(() => state, () => ({ ...DEFAULT_CONFIG, visible: true }), theme);
    expect(panel.render(38).some((line) => line.includes("computing"))).toBe(true);
  });

  it("renders no rows while hidden", () => {
    const panel = new BrainsPanel(
      () => ({
        context: null,
        model: null,
        repositories: [],
        outsideRepositoryCount: 0,
        trackedFileCount: 0,
        shellActivityObserved: false,
        gscStatus: "checking",
      }),
      () => DEFAULT_CONFIG,
      theme,
    );
    expect(panel.render(38)).toEqual([]);
  });
});
