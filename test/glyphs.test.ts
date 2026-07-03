import { describe, expect, it } from "vitest";
import { formatCompactTokens, renderGlyphText, renderTokenGlyphs } from "../extensions/pi-brains/glyphs.ts";

describe("token glyphs", () => {
  it("formats compact token values deterministically", () => {
    expect(formatCompactTokens(999)).toBe("999");
    expect(formatCompactTokens(1_500)).toBe("1.5K");
    expect(formatCompactTokens(20_000)).toBe("20K");
    expect(formatCompactTokens(128_000)).toBe("128K");
    expect(formatCompactTokens(1_000_000)).toBe("1M");
  });

  it("renders compact and wide fonts at fixed heights", () => {
    expect(renderTokenGlyphs(20_000, "3x5", "block")).toHaveLength(5);
    expect(renderTokenGlyphs(1_000_000, "5x7", "ascii")).toHaveLength(7);
  });

  it("supports a strict ASCII fallback", () => {
    const rendered = renderGlyphText("20K", "3x5", "ascii").join("\n");
    expect(rendered).toContain("#");
    expect(rendered).not.toContain("█");
  });
});
