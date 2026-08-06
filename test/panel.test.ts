import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/pi-brains/config.ts";
import { BrainsPanel, renderBrainsPanelSnapshot } from "../extensions/pi-brains/panel.ts";
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
      mailbox: null,
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
      mailbox: null,
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
        mailbox: null,
      }),
      () => DEFAULT_CONFIG,
      theme,
    );
    expect(panel.render(38)).toEqual([]);
  });

  it("renders a static snapshot even when the live panel is hidden", () => {
    const output = renderBrainsPanelSnapshot(
      {
        context: { tokens: 20_000, contextWindow: 128_000, percent: 15.625 },
        model: { id: "claude-opus-4-6", provider: "anthropic", thinkingLevel: "high" },
        repositories: [{ root: "/repo", fileCount: 1, isInitialCwd: true, files: ["/repo/src/a.ts"] }],
        outsideRepositoryCount: 0,
        trackedFileCount: 1,
        shellActivityObserved: false,
        gscStatus: "available",
        mailbox: null,
      },
      DEFAULT_CONFIG,
      38,
    );

    expect(output).toContain("CONTEXT");
    expect(output).toContain("20K / 128K");
    expect(output).toContain("FILES TRACKED");
  });
});

describe("brains panel mail section", () => {
  it("renders unread, awaiting, and wait-group progress from the mailbox summary", () => {
    const state: PanelState = {
      context: { tokens: 10_000, contextWindow: 128_000, percent: 8 },
      model: null,
      repositories: [],
      outsideRepositoryCount: 0,
      trackedFileCount: 0,
      shellActivityObserved: false,
      gscStatus: "available",
      mailbox: {
        session_id: "11111111-1111-4111-8111-111111111111",
        mailbox: {
          inbound: { pending: 2, delivering: 1, accepted: 0, ignored: 0, expired: 0 },
          outbound: { sent: 3, replied: 1, awaiting: 1, expired: 0, rejected: 0 },
        },
        wait_groups: [
          { id: "g1", expected: 2, received: 1, status: "waiting", deadline: "2026-08-05T14:00:00Z" },
          { id: "g2", expected: 1, received: 1, status: "complete", deadline: "2026-08-05T13:00:00Z" },
        ],
      },
    };
    const panel = new BrainsPanel(() => state, () => ({ ...DEFAULT_CONFIG, visible: true }), theme);
    const lines = panel.render(38);
    expect(lines.some((line) => line.includes("2 unread"))).toBe(true);
    expect(lines.some((line) => line.includes("1 being processed"))).toBe(true);
    expect(lines.some((line) => line.includes("1 awaiting reply"))).toBe(true);
    expect(lines.some((line) => line.includes("waiting 1/2"))).toBe(true);
    expect(lines.some((line) => line.includes("complete 1/1"))).toBe(true);
  });

  it("hides the mail section when there is no mail activity", () => {
    const state: PanelState = {
      context: null,
      model: null,
      repositories: [],
      outsideRepositoryCount: 0,
      trackedFileCount: 0,
      shellActivityObserved: false,
      gscStatus: "available",
      mailbox: {
        session_id: "11111111-1111-4111-8111-111111111111",
        mailbox: {
          inbound: { pending: 0, delivering: 0, accepted: 0, ignored: 0, expired: 0 },
          outbound: { sent: 1, replied: 1, awaiting: 0, expired: 0, rejected: 0 },
        },
        wait_groups: [],
      },
    };
    const panel = new BrainsPanel(() => state, () => ({ ...DEFAULT_CONFIG, visible: true }), theme);
    const lines = panel.render(38);
    expect(lines.some((line) => line.includes("MAIL"))).toBe(false);
  });
});
