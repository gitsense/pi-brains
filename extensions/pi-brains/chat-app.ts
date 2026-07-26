import { spawn } from "node:child_process";

export interface GscCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ChatAppController {
  runGscCommand(...args: string[]): Promise<GscCommandResult | null>;
}

export interface ChatAppStatus {
  state: "running" | "stopped" | "not-installed" | "unavailable";
  baseUrl: string;
  description: string;
}

export async function getChatAppStatus(controller: ChatAppController): Promise<ChatAppStatus> {
  const unavailable: ChatAppStatus = {
    state: "unavailable",
    baseUrl: "",
    description: "",
  };

  try {
    const result = await controller.runGscCommand("app", "native", "status", "--format", "json");
    if (!result || result.code !== 0) return unavailable;

    const value: unknown = JSON.parse(result.stdout);
    if (!isRecord(value)) return unavailable;

    if (value.running === true && typeof value.base_url === "string") {
      return {
        state: "running",
        baseUrl: value.base_url,
        description: `GitSense Chat is running at ${value.base_url}`,
      };
    }
    if (value.installed === true) {
      return {
        state: "stopped",
        baseUrl: "",
        description: "GitSense Chat is not running",
      };
    }
    return {
      state: "not-installed",
      baseUrl: "",
      description: "GitSense Chat is not installed",
    };
  } catch {
    return unavailable;
  }
}

export function buildChatUrl(baseUrl: string, sessionId: string): string {
  const url = new URL("/", baseUrl);
  url.searchParams.set("chat", `pi-${sessionId}`);
  return url.toString();
}

export function openExternalUrl(url: string, platform: NodeJS.Platform): Promise<void> {
  const command = platform === "darwin" ? "open" : platform === "win32" ? "rundll32.exe" : "xdg-open";
  const args = platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
