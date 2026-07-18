import { readFileSync } from "node:fs";

const supported = new Set(["rg", "grep", "find", "ls", "head", "tail", "wc", "sort", "uniq"]);
const context = JSON.parse(readFileSync(0, "utf8"));
const command = context.toolCall?.command;
const violations = typeof command === "string" ? findUnwrappedCommands(command) : [];
const matched = violations.length > 0;

console.log(JSON.stringify({
  matched,
  block: matched,
  message: matched
    ? `Observable discovery is required. Retry ${violations.join(", ")} through gsc bash -s <session-alias>, using the alias from the Pi system instructions. Wrap every pipeline segment separately.`
    : undefined,
  notice: matched ? `Blocked unwrapped discovery command: ${violations.join(", ")}.` : undefined,
  deliveryMode: matched ? "steer" : undefined,
}));

function findUnwrappedCommands(source) {
  const results = [];
  for (const segment of splitShellSegments(source)) {
    const commandName = commandHead(shellWords(segment));
    if (commandName && supported.has(commandName) && !results.includes(commandName)) results.push(commandName);
  }
  return results;
}

function splitShellSegments(source) {
  const segments = [];
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
      if (current.trim()) segments.push(current);
      current = "";
      if ((char === "|" || char === "&") && source[i + 1] === char) i++;
    } else {
      current += char;
    }
  }
  if (current.trim()) segments.push(current);
  return segments;
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
