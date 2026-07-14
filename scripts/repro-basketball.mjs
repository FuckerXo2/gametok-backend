import fs from 'fs';
import { buildClaudeStylePrompt } from '../src/ai-engine/maker-claude-style-prompt.js';
import { createDeepSeekTextClient, buildDeepSeekChatOptions } from '../src/ai-engine/deepseek-text-client.js';

const prompt = `1v1 basketball game first to score wins

Title: Duel Hoops
Description: Face off in a one-on-one basketball match where the first player to score wins. Tap to shoot, time your release, and outplay your opponent.
    Features: First-to-score win condition creates tense, fast-paced rounds, Tap-and-hold aiming for precise shot control, Local same-device turn-based play for head-to-head matches`;

const { system, user } = await buildClaudeStylePrompt(prompt);
console.log('Prompt built. Calling deepseek-v4-pro (this takes ~2-3min, matching prod)...');
const t0 = Date.now();
const client = createDeepSeekTextClient();
const chatOptions = {
  ...buildDeepSeekChatOptions('deepseek-v4-pro', 128000, { stream: false, reasoningEffort: 'high', temperature: 0.7 }),
  messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
};
const res = await client.chat.completions.create(chatOptions);
console.log('took', ((Date.now() - t0) / 1000).toFixed(1) + 's');
const raw = res.choices[0].message.content;
fs.writeFileSync('/tmp/basketball-gen-raw.json', raw);
console.log('wrote /tmp/basketball-gen-raw.json,', raw.length, 'chars');
