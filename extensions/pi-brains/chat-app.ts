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

const LOCAL_CHAT_HOST = "http://127.0.0.1";

export async function getChatAppStatus(controller: ChatAppController): Promise<ChatAppStatus> {
  const unavailable: ChatAppStatus = {
    state: "unavailable",
    baseUrl: "",
    description: "",
  };

  try {
    const result = await controller.runGscCommand("app", "native", "status", "--format", "json");
    if (!result || result.code !== 0) return unavailable;

    const value: unknown = parseStatusOutput(result.stdout);
    if (!isRecord(value)) return unavailable;

    const baseUrl = getBaseUrl(value);
    const status = typeof value.status === "string" ? value.status.toLowerCase() : "";
    if (value.running === true || status === "running") {
      return {
        state: "running",
        baseUrl,
        description: baseUrl ? `GitSense Chat is running at ${baseUrl}` : "GitSense Chat is running",
      };
    }
    if (value.installed === true || status === "stopped") {
      return {
        state: "stopped",
        baseUrl,
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

function parseStatusOutput(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    const port = stdout.match(/^\s*Port:\s*(\d+)/im)?.[1];
    const installed = stdout.match(/^\s*Installed:\s*(true|false)/im)?.[1];
    const status = stdout.match(/^\s*Status:\s*(Running|Stopped)/im)?.[1]?.toLowerCase();
    if (!port && !installed && !status) return null;
    return {
      port: port ? Number(port) : undefined,
      installed: installed === "true" ? true : installed === "false" ? false : undefined,
      status,
    };
  }
}

function getBaseUrl(value: Record<string, unknown>): string {
  if (typeof value.base_url === "string" && value.base_url.length > 0) return value.base_url;
  const port = typeof value.port === "number" ? value.port : Number(value.port);
  return Number.isInteger(port) && port > 0 ? `${LOCAL_CHAT_HOST}:${port}` : "";
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
