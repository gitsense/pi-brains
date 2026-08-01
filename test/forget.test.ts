import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeForget,
  buildBackupNote,
  buildForgetTable,
  getBackupPath,
  performForgetFileOps,
} from "../extensions/pi-brains/forget.ts";

function msg(id: string, parentId: string | null, text = ""): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-08-01T00:37:12.000Z",
    message: { role: "user", content: [{ type: "text", text }] },
  } as unknown as SessionEntry;
}

function modelChange(id: string, parentId: string | null): SessionEntry {
  return {
    type: "model_change",
    id,
    parentId,
    timestamp: "2026-08-01T00:37:12.000Z",
    provider: "deepseek",
    modelId: "deepseek-v4-flash",
  } as unknown as SessionEntry;
}

describe("analyzeForget", () => {
  it("accepts a clean linear tail", () => {
    const entries = [msg("a", null, "hi"), msg("b", "a", "hello.c"), msg("c", "b", "afdsfs"), msg("d", "c", "")];
    const result = analyzeForget(entries, "b");
    expect(result.clean).toBe(true);
    expect(result.anchor?.id).toBe("b");
    expect(result.toRemove.map((e) => e.id)).toEqual(["c", "d"]);
  });

  it("accepts mixed entry types in a clean tail", () => {
    const entries = [msg("a", null), msg("b", "a"), modelChange("c", "b"), msg("d", "c")];
    const result = analyzeForget(entries, "a");
    expect(result.clean).toBe(true);
    expect(result.toRemove.map((e) => e.id)).toEqual(["b", "c", "d"]);
  });

  it("returns clean with an empty toRemove when nothing follows the anchor", () => {
    const entries = [msg("a", null, "hi"), msg("b", "a", "hello.c")];
    const result = analyzeForget(entries, "b");
    expect(result.clean).toBe(true);
    expect(result.toRemove).toEqual([]);
  });

  it("rejects a branch at the anchor (anchor has two children)", () => {
    const entries = [msg("a", null), msg("b", "a"), msg("c", "a")];
    const result = analyzeForget(entries, "a");
    expect(result.clean).toBe(false);
    expect(result.reason).toContain("branch");
    expect(result.toRemove).toEqual([]);
  });

  it("rejects a sibling branch appended after the anchor", () => {
    // d is a child of the root, appended after the anchor's own child c
    const entries = [msg("a", null), msg("b", "a"), msg("c", "b"), msg("d", "a")];
    const result = analyzeForget(entries, "b");
    expect(result.clean).toBe(false);
    expect(result.reason).toContain("branch");
    expect(result.toRemove).toEqual([]);
  });

  it("rejects a missing anchor", () => {
    const entries = [msg("a", null), msg("b", "a")];
    const result = analyzeForget(entries, "zz");
    expect(result.clean).toBe(false);
    expect(result.reason).toContain("not found");
    expect(result.anchor).toBeNull();
  });

  it("rejects a null anchor", () => {
    const result = analyzeForget([msg("a", null)], null);
    expect(result.clean).toBe(false);
    expect(result.reason).toContain("/tree");
  });
});

describe("buildForgetTable", () => {
  it("shows the anchor separately and the entries to delete in the table", () => {
    const anchor = msg("b", "a", "read hello.c");
    const toRemove = [msg("c", "b", "afdsfs"), msg("d", "c", "")];
    const table = buildForgetTable(anchor, toRemove);
    expect(table).toContain("Anchor (kept):");
    expect(table).toContain("id:   b");
    expect(table).toContain("read hello.c");
    expect(table).toContain("These 2 entries will be deleted:");
    expect(table).toContain("c");
    expect(table).toContain("afdsfs");
    expect(table).toContain("(no visible text)");
    // The anchor must not appear inside the delete table.
    expect(table.indexOf("b") < table.indexOf("These 2 entries")).toBe(true);
  });

  it("uses singular wording for one entry", () => {
    const table = buildForgetTable(msg("a", null, "short"), [msg("b", "a", "afdsfs")]);
    expect(table).toContain("These 1 entry will be deleted:");
  });

  it("truncates long previews", () => {
    const long = "x".repeat(100);
    const anchor = msg("a", null, "short");
    const table = buildForgetTable(anchor, [msg("b", "a", long)]);
    expect(table).toContain("…");
    expect(table).not.toContain(long);
  });
});

describe("backup helpers", () => {
  it("appends .bak to the session file path", () => {
    expect(getBackupPath("/sessions/x.jsonl")).toBe("/sessions/x.jsonl.bak");
  });

  it("says a backup will be created when none exists", () => {
    const note = buildBackupNote("/sessions/x.jsonl", false);
    expect(note).toContain("will be created");
    expect(note).toContain("/sessions/x.jsonl.bak");
    expect(note).not.toContain("overwritten");
  });

  it("says an existing backup will be overwritten", () => {
    const note = buildBackupNote("/sessions/x.jsonl", true);
    expect(note).toContain("already exists and will be overwritten");
    expect(note).toContain("/sessions/x.jsonl.bak");
  });
});

describe("performForgetFileOps", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function writeSession(entries: SessionEntry[]): string {
    dir = mkdtempSync(join(tmpdir(), "forget-test-"));
    const path = join(dir, "session.jsonl");
    const header = JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-1",
      timestamp: "2026-08-01T00:37:03.063Z",
      cwd: "/tmp",
    });
    const body = entries.map((e) => JSON.stringify(e)).join("\n");
    writeFileSync(path, `${header}\n${body}\n`);
    return path;
  }

  it("backs up the original and trims the file to end at the anchor", () => {
    const path = writeSession([
      msg("a", null, "hi"),
      msg("b", "a", "hello.c"),
      msg("c", "b", "afdsfs"),
      msg("d", "c", ""),
    ]);
    const result = performForgetFileOps(path, [msg("c", "b", "afdsfs"), msg("d", "c", "")]);

    expect(result.backupPath).toBe(`${path}.bak`);
    expect(result.removedCount).toBe(2);

    const backup = readFileSync(`${path}.bak`, "utf8");
    expect(backup).toContain("afdsfs");
    expect(backup).toContain("hello.c");

    const trimmed = readFileSync(path, "utf8");
    expect(trimmed).toContain("hello.c");
    expect(trimmed).not.toContain("afdsfs");
    const ids = trimmed.trimEnd().split("\n").map((line) => (JSON.parse(line) as { id: string }).id);
    expect(ids).toEqual(["sess-1", "a", "b"]);

    // temp file is cleaned up
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("overwrites an existing backup", () => {
    const path = writeSession([msg("a", null, "hi"), msg("b", "a", "afdsfs")]);
    writeFileSync(`${path}.bak`, "OLD BACKUP");

    performForgetFileOps(path, [msg("b", "a", "afdsfs")]);

    const backup = readFileSync(`${path}.bak`, "utf8");
    expect(backup).not.toBe("OLD BACKUP");
    expect(backup).toContain("afdsfs");
  });

  it("keeps malformed lines as-is", () => {
    const path = writeSession([msg("a", null, "hi"), msg("b", "a", "afdsfs")]);
    // Append a malformed line after the header so it cannot be parsed
    const raw = readFileSync(path, "utf8");
    writeFileSync(path, `${raw}this is not json\n`);

    performForgetFileOps(path, [msg("b", "a", "afdsfs")]);

    const trimmed = readFileSync(path, "utf8");
    expect(trimmed).toContain("this is not json");
    expect(trimmed).not.toContain("afdsfs");
  });
});
