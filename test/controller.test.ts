import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, OverlayOptions, TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/pi-brains/config.ts";
import { PiBrainsController } from "../extensions/pi-brains/controller.ts";

describe("pi-brains overlay lifecycle", () => {
  it("owns a non-capturing responsive overlay and hides it on disposal", () => {
    const handle = {
      hide: vi.fn(),
      setHidden: vi.fn(),
    } as unknown as OverlayHandle;
    let options: OverlayOptions | undefined;
    const tui = {
      requestRender: vi.fn(),
      showOverlay: vi.fn((_component: Component, overlayOptions: OverlayOptions) => {
        options = overlayOptions;
        return handle;
      }),
    } as unknown as TUI;
    let owner: (Component & { dispose?(): void }) | undefined;
    const ctx = {
      cwd: "/repo",
      getContextUsage: () => null,
      model: null,
      sessionManager: { getBranch: () => [] },
      ui: {
        setWidget: (
          _key: string,
          factory: ((tui: TUI, theme: Theme) => Component & { dispose?(): void }) | undefined,
        ) => {
          owner = factory?.(tui, { fg: (_color: string, text: string) => text } as unknown as Theme);
        },
      },
    } as unknown as ExtensionContext;
    const pi = {
      exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0, killed: false }),
      getThinkingLevel: () => "off",
      on: vi.fn(),
    } as unknown as ExtensionAPI;
    const controller = new PiBrainsController(pi, { ...DEFAULT_CONFIG, visible: true });

    controller.start(ctx);

    expect(options).toMatchObject({ anchor: "top-right", width: 38, maxHeight: "100%", nonCapturing: true });
    expect(options?.visible?.(99, 40)).toBe(false);
    expect(options?.visible?.(100, 40)).toBe(true);
    expect(handle.setHidden).toHaveBeenCalledWith(true);
    expect(owner?.render(80)).toEqual([]);

    controller.dispose();
    expect(handle.hide).toHaveBeenCalledTimes(1);
  });
});
