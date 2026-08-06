import { describe, expect, it } from "vitest";
import { buildSummaryInstructions } from "../extensions/pi-brains/summary.ts";

describe("buildSummaryInstructions", () => {
  it("includes the fixed markdown sections", () => {
    const instructions = buildSummaryInstructions(null);
    expect(instructions).toContain("## <Title>");
    expect(instructions).toContain("### What was discussed");
    expect(instructions).toContain("### Topics");
    expect(instructions).toContain("### Key decisions");
  });

  it("tells the agent to reply with the summary text only", () => {
    const instructions = buildSummaryInstructions(null);
    expect(instructions).toContain("output ONLY the summary");
    expect(instructions).toContain("Do not write any files");
  });

  it("uses the session name as title base when set", () => {
    const instructions = buildSummaryInstructions("colors work");
    expect(instructions).toContain('The session name is "colors work".');
  });

  it("derives the title from content when no session name is set", () => {
    const instructions = buildSummaryInstructions(null);
    expect(instructions).toContain("No session name is set.");
  });
});
