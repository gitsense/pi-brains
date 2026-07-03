import { relative } from "node:path";

export interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  isFile: boolean;
}

type TrieValue = Map<string, TrieValue> | null;

export function buildFileTree(files: Iterable<string>, root: string): TreeNode[] {
  const relativePaths = new Set<string>();
  for (const file of files) {
    const rel = relative(root, file);
    if (rel.startsWith("..")) continue;
    relativePaths.add(rel);
  }

  const trie = new Map<string, TrieValue>();

  for (const rel of relativePaths) {
    const segments = rel.split("/");
    let current = trie;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment === undefined) continue;
      if (i === segments.length - 1) {
        current.set(segment, null);
      } else {
        const existing = current.get(segment);
        if (existing === undefined || existing === null) {
          const directory = new Map<string, TrieValue>();
          current.set(segment, directory);
          current = directory;
        } else {
          current = existing;
        }
      }
    }
  }

  return trieToNodes(trie, "");
}

export function renderTree(nodes: TreeNode[], maxWidth: number, indent = ""): string[] {
  const lines: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) continue;
    const isLast = i === nodes.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childIndent = indent + (isLast ? "    " : "│   ");
    const displayName = node.isFile ? node.name : `${node.name}/`;

    lines.push(truncateLine(`${indent}${connector}${displayName}`, maxWidth));

    if (node.children.length > 0) {
      lines.push(...renderTree(node.children, maxWidth, childIndent));
    }
  }

  return lines;
}

function trieToNodes(trie: Map<string, TrieValue>, basePath: string): TreeNode[] {
  const nodes: TreeNode[] = [];

  for (const [name, value] of trie) {
    const relPath = basePath ? `${basePath}/${name}` : name;

    if (value === null) {
      nodes.push({ name, path: relPath, children: [], isFile: true });
    } else {
      const children = trieToNodes(value, relPath);

      if (children.length === 1 && children[0] && !children[0].isFile) {
        const child = children[0];
        nodes.push({
          name: `${name}/${child.name}`,
          path: child.path,
          children: child.children,
          isFile: false,
        });
      } else {
        nodes.push({ name, path: relPath, children, isFile: false });
      }
    }
  }

  nodes.sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

function truncateLine(line: string, maxWidth: number): string {
  if (line.length <= maxWidth) return line;
  return `${line.slice(0, maxWidth - 1)}…`;
}
