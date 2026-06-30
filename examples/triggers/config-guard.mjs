// Config file guard trigger
// Blocks edits to production configuration files
// DevOps can bypass by setting CONFIG_EDIT_APPROVED=true

import { readFileSync } from 'node:fs';
const ctx = JSON.parse(readFileSync(0, 'utf8'));

const toolCall = ctx.toolCall || {};
const file = toolCall.file || '';
const action = toolCall.action || '';

if (action !== 'edit' && action !== 'write') {
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

if (!file.includes('config/production') && !file.includes('.env.production')) {
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

const approved = process.env.CONFIG_EDIT_APPROVED === 'true';

if (approved) {
  console.log(JSON.stringify({
    matched: true,
    block: false,
    notice: `Config edit approved. Proceeding with ${ctx.repo?.normalizedFile || file}.`
  }));
} else {
  console.log(JSON.stringify({
    matched: true,
    block: true,
    message: `Production config changes require approval.\n\nTo approve:\n1. Create a change request ticket\n2. Get approval from your team lead\n3. Set CONFIG_EDIT_APPROVED=true in your environment\n\nThen retry the edit.`
  }));
}
