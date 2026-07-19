import { readFileSync } from "node:fs";

const supported = new Set(["rg", "grep", "find", "ls", "head", "tail", "wc", "sort", "uniq"]);
const context = JSON.parse(readFileSync(0, "utf8"));
const command = context.toolCall?.command;
const violations = typeof command === "string" ? findUnwrappedCommands(command) : [];
const matched = violations.length > 0;
const rewrite = matched ? rewriteCommand(command) : null;

console.log(JSON.stringify({
  matched,
  block: false,
  message: matched
    ? buildGuidance(command, violations, rewrite)
    : undefined,
  notice: matched
    ? `Observable discovery recommended: wrap ${violations.join(", ")} with gsc bash.`
    : undefined,
  deliveryMode: matched ? "passiveSteer" : undefined,
}));

function buildGuidance(command, violations, rewrite) {
  const lines = [
    "[Observable discovery]",
    "",
    `Unwrapped command${violations.length === 1 ? "" : "s"}: ${violations.join(", ")}`,
    "",
    "Avoid:",
    `  ${command}`,
    "",
  ];
  if (rewrite.exact) {
    lines.push("Use:", `  ${rewrite.command}`);
  } else {
    lines.push(
      "Use this form for each supported discovery segment:",
      "  gsc bash -s <session-alias> <command> [args...]",
      "",
      "Keep shell operators outside the wrapper and wrap each supported pipeline or chained segment separately.",
    );
  }
  lines.push(
    "",
    "Why: this records exact search intent, working directory, file evidence, pipeline truncation, and brains available during discovery.",
    "This call will proceed because the shell policy is advisory.",
  );
  return lines.join("\n");
}

function rewriteCommand(source) {
  let exact = true;
  const parts = splitShellComposition(source).map(({ segment, separator }) => {
    const trimmed = segment.trim();
    const words = shellWords(trimmed);
    const commandName = commandHead(words);
    if (!commandName || !supported.has(commandName) || isWrapped(words)) {
      return segment + separator;
    }

    const first = words[0]?.split("/").pop();
    if (first !== commandName) {
      exact = false;
      return segment + separator;
    }

    const leading = segment.slice(0, segment.length - segment.trimStart().length);
    return `${leading}gsc bash -s <session-alias> ${segment.trimStart()}${separator}`;
  });
  return { command: parts.join(""), exact };
}

function isWrapped(words) {
  return words[0]?.split("/").pop() === "gsc" && words[1] === "bash";
}

function findUnwrappedCommands(source) {
  const results = [];
  for (const segment of splitShellSegments(source)) {
    const commandName = commandHead(shellWords(segment));
    if (commandName && supported.has(commandName) && !results.includes(commandName)) results.push(commandName);
  }
  return results;
}

function splitShellSegments(source) {
  return splitShellComposition(source).map(part => part.segment).filter(segment => segment.trim());
}

function splitShellComposition(source) {
  const parts = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\" && quote !== "'") {
      current += char;
      escaped = true;
    } else if (quote) {
      current += char;
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
      current += char;
    } else if (char === "|" || char === "&" || char === ";" || char === "\n") {
      let separator = char;
      if ((char === "|" || char === "&") && source[i + 1] === char) {
        separator += source[++i];
      }
      parts.push({ segment: current, separator });
      current = "";
    } else {
      current += char;
    }
  }
  parts.push({ segment: current, separator: "" });
  return parts;
}

function shellWords(segment) {
  const words = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (const char of segment.trim().replace(/^[({!]+\s*/, "")) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) words.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) words.push(current);
  return words;
}

function commandHead(words) {
  let index = 0;
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) index++;
  while (["if", "then", "do", "else", "elif"].includes(words[index])) index++;
  if (["command", "builtin", "exec"].includes(words[index])) index++;
  if (words[index] === "sudo") {
    index++;
    while (words[index]?.startsWith("-")) index++;
  }
  if (words[index] === "env") {
    index++;
    while (words[index]?.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] ?? "")) index++;
  }
  const value = words[index];
  return value ? value.split("/").pop() : null;
}
