import type { GlyphFont, GlyphStyle } from "./types.ts";

type GlyphMap = Readonly<Record<string, readonly string[]>>;

const COMPACT_GLYPHS: GlyphMap = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  K: ["101", "110", "100", "110", "101"],
  M: ["10001", "11011", "10101", "10001", "10001"],
  B: ["110", "101", "110", "101", "110"],
  ".": ["0", "0", "0", "0", "1"],
};

const WIDE_GLYPHS: GlyphMap = {
  "0": ["11111", "10001", "10001", "10001", "10001", "10001", "11111"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "11111"],
  "2": ["11111", "00001", "00001", "11111", "10000", "10000", "11111"],
  "3": ["11111", "00001", "00001", "01111", "00001", "00001", "11111"],
  "4": ["10001", "10001", "10001", "11111", "00001", "00001", "00001"],
  "5": ["11111", "10000", "10000", "11111", "00001", "00001", "11111"],
  "6": ["11111", "10000", "10000", "11111", "10001", "10001", "11111"],
  "7": ["11111", "00001", "00010", "00100", "00100", "00100", "00100"],
  "8": ["11111", "10001", "10001", "11111", "10001", "10001", "11111"],
  "9": ["11111", "10001", "10001", "11111", "00001", "00001", "11111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  ".": ["0", "0", "0", "0", "0", "0", "1"],
};

export function formatCompactTokens(tokens: number): string {
  const safeTokens = Math.max(0, Math.round(tokens));
  if (safeTokens < 1_000) return String(safeTokens);
  if (safeTokens < 10_000) return `${(safeTokens / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  if (safeTokens < 999_500) return `${Math.round(safeTokens / 1_000)}K`;
  if (safeTokens < 10_000_000) return `${(safeTokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (safeTokens < 999_500_000) return `${Math.round(safeTokens / 1_000_000)}M`;
  if (safeTokens < 10_000_000_000) return `${(safeTokens / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  return `${Math.round(safeTokens / 1_000_000_000)}B`;
}

export function renderGlyphText(text: string, font: GlyphFont, style: GlyphStyle): string[] {
  const glyphs = font === "5x7" ? WIDE_GLYPHS : COMPACT_GLYPHS;
  const fill = style === "ascii" ? "#" : "█";
  const normalized = text.toUpperCase();
  const height = font === "5x7" ? 7 : 5;
  const lines = Array.from({ length: height }, () => "");

  for (const character of normalized) {
    const glyph = glyphs[character];
    if (!glyph) continue;
    for (let row = 0; row < height; row++) {
      const pixels = glyph[row] ?? "";
      lines[row] += `${lines[row] ? " " : ""}${pixels.replaceAll("1", fill).replaceAll("0", " ")}`;
    }
  }

  return lines;
}

export function renderTokenGlyphs(tokens: number, font: GlyphFont, style: GlyphStyle): string[] {
  return renderGlyphText(formatCompactTokens(tokens), font, style);
}
