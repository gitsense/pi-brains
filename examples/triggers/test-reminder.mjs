// Test file reminder trigger
// Reminds to run tests after editing test files

import { readFileSync } from 'node:fs';
const ctx = JSON.parse(readFileSync(0, 'utf8'));

const toolCall = ctx.toolCall || {};
const file = toolCall.file || '';
const action = toolCall.action || '';

if (action !== 'edit' && action !== 'write') {
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

const isTestFile = file.includes('.test.') || file.includes('.spec.') || file.includes('__tests__');
if (!isTestFile) {
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

console.log(JSON.stringify({
  matched: true,
  block: false,
  notice: `You edited a test file (${ctx.repo?.normalizedFile || file}). Consider running the tests to verify your changes.`
}));
