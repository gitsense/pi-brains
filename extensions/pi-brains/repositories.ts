import { basename, dirname, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RepositoryState } from "./types.ts";

export class RepositoryResolver {
  private readonly pi: ExtensionAPI;
  private readonly directoryCache = new Map<string, Promise<string | null>>();
  private readonly fileRoots = new Map<string, string | null>();
  private readonly abortController = new AbortController();
  private generation = 0;
  private disposed = false;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
  }

  resolveFiles(files: ReadonlySet<string>, onUpdate: () => void): void {
    const generation = this.generation;
    for (const file of files) {
      if (this.fileRoots.has(file)) continue;
      void this.resolveFile(file).then((root) => {
        if (this.disposed || generation !== this.generation) return;
        this.fileRoots.set(file, root);
        onUpdate();
      });
    }
  }

  getRepositories(initialCwd: string): RepositoryState[] {
    const byRoot = new Map<string, string[]>();
    for (const [file, root] of this.fileRoots) {
      if (!root) continue;
      const list = byRoot.get(root);
      if (list) list.push(file);
      else byRoot.set(root, [file]);
    }

    return [...byRoot.entries()]
      .map(([root, files]) => ({
        root,
        fileCount: files.length,
        isInitialCwd: !relative(root, initialCwd).startsWith(".."),
        files,
      }))
      .sort((a, b) => Number(b.isInitialCwd) - Number(a.isInitialCwd) || basename(a.root).localeCompare(basename(b.root)));
  }

  getOutsideRepositoryCount(): number {
    let count = 0;
    for (const root of this.fileRoots.values()) {
      if (root === null) count++;
    }
    return count;
  }

  getFileRoots(): ReadonlyMap<string, string | null> {
    return this.fileRoots;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.abortController.abort();
    this.directoryCache.clear();
  }

  private resolveFile(file: string): Promise<string | null> {
    const directory = dirname(file);
    const cached = this.directoryCache.get(directory);
    if (cached) return cached;

    const pending = this.pi
      .exec("git", ["-C", directory, "rev-parse", "--show-toplevel"], {
        signal: this.abortController.signal,
        timeout: 2_000,
      })
      .then((result) => (result.code === 0 ? result.stdout.trim() || null : null))
      .catch(() => null);
    this.directoryCache.set(directory, pending);
    return pending;
  }
}
