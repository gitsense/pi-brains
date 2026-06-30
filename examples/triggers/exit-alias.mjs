// Exit command alias trigger
// Intercepts "exit" and shows guidance to use /quit instead

import { readFileSync } from 'node:fs';
const ctx = JSON.parse(readFileSync(0, 'utf8'));
const text = (ctx.payload?.prompt?.text || '').trim();

if (text === 'exit') {
  console.log(JSON.stringify({
    matched: true,
    block: true,
    message: "Pi uses /quit to exit. Type /quit or press Ctrl+D."
  }));
} else {
  console.log(JSON.stringify({ matched: false, block: false }));
}
