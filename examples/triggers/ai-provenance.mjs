// AI provenance tracking trigger
// Records AI-authored changes to third-party code for audit purposes

import { readFileSync, appendFileSync } from 'node:fs';
const ctx = JSON.parse(readFileSync(0, 'utf8'));

const toolCall = ctx.toolCall || {};
const file = toolCall.file || '';

if (!file.startsWith('third_party/') && !file.includes('/vendor/')) {
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

const entry = {
  file: ctx.repo?.normalizedFile || file,
  timestamp: new Date().toISOString(),
  model: ctx.model?.id || 'unknown',
  status: 'pending'
};

try {
  appendFileSync('.gitsense/ai-provenance.jsonl', JSON.stringify(entry) + '\n');
} catch {
  // File may not exist yet
}

console.log(JSON.stringify({
  matched: true,
  block: false,
  notice: `AI provenance entry created for ${ctx.repo?.normalizedFile || file}`,
  deliveryMode: "passiveSteer"
}));
