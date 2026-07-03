import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { RepositoryResolver } from "../extensions/pi-brains/repositories.ts";

describe("repository resolution", () => {
  it("groups files by resolved repository and caches directories", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "/repo\n", stderr: "", code: 0, killed: false });
    const pi = { exec } as unknown as ExtensionAPI;
    const resolver = new RepositoryResolver(pi);
    const updated = vi.fn();

    resolver.resolveFiles(new Set(["/repo/src/a.ts", "/repo/src/b.ts"]), updated);
    await vi.waitFor(() => expect(updated).toHaveBeenCalledTimes(2));

    expect(exec).toHaveBeenCalledTimes(1);
    expect(resolver.getRepositories("/repo")).toEqual([{ root: "/repo", fileCount: 2, isInitialCwd: true, files: ["/repo/src/a.ts", "/repo/src/b.ts"] }]);
    resolver.dispose();
  });
});
