// Generated file warning trigger
// Warns when editing auto-generated files without blocking

import { readFileSync } from 'node:fs';
const ctx = JSON.parse(readFileSync(0, 'utf8'));

const toolCall = ctx.toolCall || {};
const file = toolCall.file || '';
const action = toolCall.action || '';

if (action !== 'edit' && action !== 'write') {
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

if (!file.includes('generated') && !file.includes('auto-generated')) {
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

console.log(JSON.stringify({
  matched: true,
  block: false,
  notice: `WARNING: You are editing an auto-generated file (${ctx.repo?.normalizedFile || file}). Consider editing the source schema instead.`
}));
