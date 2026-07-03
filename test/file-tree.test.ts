import { describe, expect, it } from "vitest";
import { buildFileTree, renderTree } from "../extensions/pi-brains/file-tree.ts";

describe("buildFileTree", () => {
  it("builds a tree from flat paths", () => {
    const files = ["/repo/src/a.ts", "/repo/src/b.ts", "/repo/test/c.test.ts"];
    const tree = buildFileTree(files, "/repo");

    // src/ has 2 children -> kept as directory
    // test/ has 1 file child -> files stay as leaves
    expect(tree).toEqual([
      {
        name: "src",
        path: "src",
        isFile: false,
        children: [
          { name: "a.ts", path: "src/a.ts", isFile: true, children: [] },
          { name: "b.ts", path: "src/b.ts", isFile: true, children: [] },
        ],
      },
      {
        name: "test",
        path: "test",
        isFile: false,
        children: [
          { name: "c.test.ts", path: "test/c.test.ts", isFile: true, children: [] },
        ],
      },
    ]);
  });

  it("keeps files as leaves even when single child", () => {
    const files = ["/repo/src/components/Button.tsx"];
    const tree = buildFileTree(files, "/repo");

    // src/components/ is a single directory chain -> collapsed, but Button.tsx stays as leaf
    expect(tree).toEqual([
      {
        name: "src/components",
        path: "src/components",
        isFile: false,
        children: [
          { name: "Button.tsx", path: "src/components/Button.tsx", isFile: true, children: [] },
        ],
      },
    ]);
  });

  it("collapses single-child directory with single directory child", () => {
    const files = ["/repo/src/components/ui/Button.tsx", "/repo/src/components/ui/Input.tsx"];
    const tree = buildFileTree(files, "/repo");

    expect(tree).toEqual([
      {
        name: "src/components/ui",
        path: "src/components/ui",
        isFile: false,
        children: [
          { name: "Button.tsx", path: "src/components/ui/Button.tsx", isFile: true, children: [] },
          { name: "Input.tsx", path: "src/components/ui/Input.tsx", isFile: true, children: [] },
        ],
      },
    ]);
  });

  it("ignores files outside root", () => {
    const files = ["/repo/src/a.ts", "/other/b.ts"];
    const tree = buildFileTree(files, "/repo");

    // src/ has single file child -> file stays as leaf
    expect(tree).toEqual([
      {
        name: "src",
        path: "src",
        isFile: false,
        children: [
          { name: "a.ts", path: "src/a.ts", isFile: true, children: [] },
        ],
      },
    ]);
  });
});

describe("renderTree", () => {
  it("renders tree with proper glyphs", () => {
    const tree = [
      {
        name: "src",
        path: "src",
        isFile: false,
        children: [
          { name: "a.ts", path: "src/a.ts", isFile: true, children: [] },
          { name: "b.ts", path: "src/b.ts", isFile: true, children: [] },
        ],
      },
      { name: "README.md", path: "README.md", isFile: true, children: [] },
    ];

    const lines = renderTree(tree, 40);
    expect(lines).toEqual([
      "├── src/",
      "│   ├── a.ts",
      "│   └── b.ts",
      "└── README.md",
    ]);
  });

  it("truncates long lines", () => {
    const tree = [
      { name: "very-long-filename-that-exceeds-width.ts", path: "very-long-filename-that-exceeds-width.ts", isFile: true, children: [] },
    ];

    const lines = renderTree(tree, 20);
    // "└── " is 4 chars, so 16 chars for name + ellipsis
    expect(lines[0]).toHaveLength(20);
    expect(lines[0].startsWith("└── ")).toBe(true);
    expect(lines[0].endsWith("…")).toBe(true);
  });
});
