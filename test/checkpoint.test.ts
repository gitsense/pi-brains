import { describe, expect, it } from "vitest";
import { buildCheckpointInstructions } from "../extensions/pi-brains/checkpoint.ts";

describe("checkpoint instructions", () => {
  it("supplies Pi provenance and delegates repository metadata to gsc", () => {
    const instructions = buildCheckpointInstructions(
      "session-123",
      "leaf-456",
      "chk-789",
      "/tmp/repo with 'quote'",
      {
        files: ["/tmp/repo with 'quote'/components/pi/cards.ts", "/tmp/outside.ts"],
        tools: ["read", "edit"],
        rules: ["rule-ui"],
        baselineHead: null,
        sessionStartBranch: null,
      },
    );

    expect(instructions).toContain(
      '- source: {"agent": "pi", "nativeSessionId": "session-123", "anchorLeafId": "leaf-456"}',
    );
    expect(instructions).not.toContain('- workspace_repository:');
    expect(instructions).toContain("gsc append command derives and overwrites repository metadata");
    expect(instructions).toContain('- files: ["components/pi/cards.ts"]');
    expect(instructions).not.toContain("/tmp/outside.ts");
    expect(instructions).toContain('- tools: ["read","edit"]');
    expect(instructions).toContain('- rules: ["rule-ui"]');
    expect(instructions).toContain("Optimize the checkpoint for future discovery");
    expect(instructions).toContain("Aim for 1200 characters or fewer; 2000 characters is the hard maximum");
    expect(instructions).toContain("Move enumerated facts and history into evidence, decisions, risks, and open_questions");
    expect(instructions).toContain(".current_understanding | length");
    expect(instructions).toContain("--repo '/tmp/repo with '\\''quote'\\''' --target personal");
  });

  it("requires a full file-change audit including bash-driven changes", () => {
    const instructions = buildCheckpointInstructions("session", "leaf", "checkpoint", "/repo", {
      files: ["/repo/src/a.ts"],
      tools: ["edit"],
      rules: [],
      baselineHead: "abc123",
      sessionStartBranch: "main",
    });

    expect(instructions).toContain("STEP 1: Audit ALL file changes");
    expect(instructions).toContain("git status --porcelain --untracked-files=all");
    expect(instructions).toContain("git diff --name-only abc123");
    expect(instructions).toContain("switched branches this session");
    expect(instructions).toContain("never record a file just because git lists it");
    expect(instructions).toContain("adjudicate every candidate against the conversation");
    expect(instructions).toContain("file_changes");
    expect(instructions).toContain('"bash" (changed via a shell command)');
    expect(instructions).toContain('"repository"');
    expect(instructions).toContain("repositories legend");
    expect(instructions).toContain('root + "/" + path');
    expect(instructions).toContain('For "moved", record the destination path');
    expect(instructions).not.toContain("Bash commands observed");
    expect(instructions).not.toContain("perl -i -pe");
    expect(instructions).not.toContain("Preserve them exactly; do not infer replacements");
  });

  it("falls back to git status when no baseline is available", () => {
    const instructions = buildCheckpointInstructions("session", "leaf", "checkpoint", "/repo", {
      files: [],
      tools: [],
      rules: [],
      baselineHead: null,
      sessionStartBranch: null,
    });

    expect(instructions).toContain("git status --porcelain --untracked-files=all");
    expect(instructions).not.toContain("git diff --name-only <");
    expect(instructions).not.toContain("(unknown)");
  });

  it("uses contiguous workflow step numbers", () => {
    const instructions = buildCheckpointInstructions("session", "leaf", "checkpoint", "/repo");
    const steps = [...instructions.matchAll(/^STEP (\d+):/gm)].map((match) => Number(match[1]));

    expect(steps).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
