import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseConfig } from "../extensions/pi-brains/config.ts";

describe("configuration", () => {
  it("uses defaults for missing or malformed input", () => {
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(parseConfig({ width: 2, font: "huge" })).toMatchObject({ width: 38, font: "3x5" });
  });

  it("accepts supported customization", () => {
    expect(
      parseConfig({
        visible: true,
        width: 44,
        minTerminalWidth: 120,
        font: "5x7",
        glyph: "ascii",
        brightness: "normal",
        showModel: false,
        showRepositories: false,
        dismissedNotices: ["gsc-missing-v1", 4],
        askGroups: [{
          id: "group-1",
          url: "http://localhost:3357/?chat=pi-sessions&track=expert-a&track-name=Experts",
          createdAt: "2026-08-03T00:00:00.000Z",
          updatedAt: "2026-08-03T00:00:00.000Z",
        }],
      }),
    ).toEqual({
      visible: true,
      width: 44,
      minTerminalWidth: 120,
      font: "5x7",
      glyph: "ascii",
      brightness: "normal",
      showModel: false,
      showRepositories: false,
      dismissedNotices: ["gsc-missing-v1"],
      rulesEnabled: true,
      debug: false,
      guideEnabled: false,
      inboxAutoAccept: false,
      askGroups: [{
        id: "group-1",
        url: "http://localhost:3357/?chat=pi-sessions&track=expert-a&track-name=Experts",
        createdAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
      }],
    });
  });

  it("preserves registered knowledge groups", () => {
    expect(parseConfig({
      askGroups: [{
        id: "group-1",
        url: "http://localhost:3357/?chat=pi-sessions&track=expert-a&track-name=Experts",
        createdAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T01:00:00.000Z",
      }],
    }).askGroups).toEqual([{
      id: "group-1",
      url: "http://localhost:3357/?chat=pi-sessions&track=expert-a&track-name=Experts",
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T01:00:00.000Z",
    }]);
  });
});
