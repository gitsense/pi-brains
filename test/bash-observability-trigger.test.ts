import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const advisory = resolve("rules/gsc-bash-observability/advisory-trigger.mjs");
const strict = resolve("rules/gsc-bash-observability/strict-trigger.mjs");

function run(entry: string, command: string) {
  const input = JSON.stringify({ toolCall: { action: "bash", command } });
  return JSON.parse(execFileSync(process.execPath, [entry], { input, encoding: "utf8" }));
}

describe("gsc bash observability rule triggers", () => {
  it("allows fully wrapped pipelines", () => {
    expect(run(strict, "gsc bash -s a1b2c3 rg needle . | gsc bash -s a1b2c3 head -n 20"))
      .toMatchObject({ matched: false, block: false });
  });

  it("finds unwrapped commands across shell compositions", () => {
    const result = run(strict, "cd src && rg needle . | head -n 20; wc -l");
    expect(result).toMatchObject({ matched: true, block: true });
    expect(result.message).toContain("rg, head, wc");
  });

  it("handles common command prefixes", () => {
    expect(run(strict, "FOO=bar rg needle .")).toMatchObject({ matched: true, block: true });
    expect(run(strict, "sudo -n find . -name '*.go'")).toMatchObject({ matched: true, block: true });
    expect(run(strict, "env LC_ALL=C sort names.txt")).toMatchObject({ matched: true, block: true });
  });

  it("does not treat quoted separators as commands", () => {
    expect(run(strict, "printf '%s' 'rg foo | head -n 1'"))
      .toMatchObject({ matched: false, block: false });
  });

  it("advises without blocking", () => {
    expect(run(advisory, "grep -R needle ."))
      .toMatchObject({ matched: true, block: false, deliveryMode: "passiveSteer" });
  });

  it.each(["advisory", "strict"])("embeds the reviewed %s trigger in its bundle", variant => {
    const source = readFileSync(resolve(`rules/gsc-bash-observability/${variant}-trigger.mjs`));
    const bundle = JSON.parse(readFileSync(
      resolve(`rules/gsc-bash-observability/${variant}.bundle.json`),
      "utf8",
    ));
    const asset = bundle.assets[0];

    expect(bundle.schemaVersion).toBe("gsc.rules.bundle.v1");
    expect(bundle.rules[0].rule.id).toBe("rule_pi_bash_observability_v1");
    expect(Buffer.from(asset.contentBase64, "base64")).toEqual(source);
    expect(asset.sha256).toBe(`sha256:${createHash("sha256").update(source).digest("hex")}`);
  });
});
