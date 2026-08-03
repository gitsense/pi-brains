import { describe, expect, it } from "vitest";
import { buildAskGroupUrl, createAskGroup, parseAskGroupUrl, renameAskGroup } from "../extensions/pi-brains/ask-groups.ts";

const GROUP_URL = "http://localhost:3357/?chat=pi-sessions&from-index=1&to-index=30&session=expert-a&track=expert-a%2Cexpert-b&track-name=Pi+Search+Crew&track-description=Experts+for+Pi+search";
const CURRENT_SESSION = "main-session";

describe("knowledge group URLs", () => {
  it("extracts the group metadata and tracked sessions", () => {
    expect(parseAskGroupUrl(GROUP_URL)).toMatchObject({
      name: "Pi Search Crew",
      description: "Experts for Pi search",
      trackedSessionIds: ["expert-a", "expert-b"],
    });
  });

  it("adds the current session to a temporary opening URL", () => {
    const group = createAskGroup(GROUP_URL, "2026-08-03T00:00:00.000Z", "group-1");
    const opened = new URL(buildAskGroupUrl(group, CURRENT_SESSION));

    expect(opened.searchParams.get("session")).toBe(CURRENT_SESSION);
    expect(opened.searchParams.get("track")).toBe("expert-a,expert-b,main-session");
    expect(group.url).toBe(parseAskGroupUrl(GROUP_URL).url);
  });

  it("does not duplicate the current session when it is already tracked", () => {
    const group = createAskGroup(GROUP_URL, "2026-08-03T00:00:00.000Z", "group-1");
    const opened = new URL(buildAskGroupUrl(group, "expert-a"));

    expect(opened.searchParams.get("track")).toBe("expert-a,expert-b");
  });

  it("renames a group by changing the saved URL metadata", () => {
    const group = createAskGroup(GROUP_URL, "2026-08-03T00:00:00.000Z", "group-1");
    const renamed = renameAskGroup(group, "Pi Navigation Experts", "2026-08-03T01:00:00.000Z");

    expect(parseAskGroupUrl(renamed.url).name).toBe("Pi Navigation Experts");
    expect(parseAskGroupUrl(renamed.url).trackedSessionIds).toEqual(["expert-a", "expert-b"]);
    expect(renamed.updatedAt).toBe("2026-08-03T01:00:00.000Z");
  });

  it.each([
    ["https://example.com/?chat=other&track=expert-a&track-name=Group", "chat=pi-sessions"],
    ["https://example.com/?chat=pi-sessions&track=expert-a", "group name"],
    ["https://example.com/?chat=pi-sessions&track-name=Group", "tracked sessions"],
  ])("rejects a group URL without %s", (url, expected) => {
    expect(() => parseAskGroupUrl(url)).toThrow(expected);
  });
});
