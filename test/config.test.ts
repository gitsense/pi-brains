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
    });
  });
});
