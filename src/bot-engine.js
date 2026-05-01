import { randomUUID } from 'crypto';
import express from 'express';
import pool from './db.js';
import {
  executeDreamJob,
  upsertPublishedAIGame,
  createPendingJob,
} from './ai-engine/routes.js';

const BOT_EMAIL_DOMAIN = 'bots.gametok.local';
const BOT_USERNAME_PREFIX = 'gt_';

const BOT_FIRST_NAMES = [
  'Alex', 'Jordan', 'Taylor', 'Riley', 'Avery', 'Quinn', 'Kai', 'Milo', 'Nova', 'Luna',
  'Zara', 'Nico', 'Sage', 'River', 'Ivy', 'Leo', 'Mia', 'Theo', 'Yuna', 'Remy',
  'Cleo', 'Jude', 'Hana', 'Ezra', 'Sora', 'Max', 'Ruby', 'Zoe', 'Felix', 'Kira',
];

const BOT_VIBES = [
  'arcade kid', 'speedrunner', 'cozy gamer', 'horror fan', 'quiz brain', 'rhythm addict',
  'high score hunter', 'puzzle goblin', 'chaos player', 'retro enjoyer', 'platformer fan',
  'party game person', 'casual grinder', 'tiny game critic', 'collector', 'boss fight lover',
];

const BOT_BIOS = [
  'Playing quick games between everything else.',
  'Trying to beat one more score.',
  'Here for tiny games and weird ideas.',
  'I rate games by how fast they hook me.',
  'Casual gamer, serious about leaderboards.',
  'Send me the hardest game you made.',
  'Five minute games are my weakness.',
  'Always looking for something strange to play.',
  '',
  '',
];

const BOT_COMMENTS = [
  'this got addictive fast',
  'wait this is actually fun',
  'the pacing on this one is clean',
  'i need one more run',
  'simple but it works',
  'this would go crazy with more levels',
  'the controls feel good',
  'not me replaying this again',
  'this is harder than it looks',
  'solid idea',
  'i like the vibe here',
  'this one cooked',
  'high score is beatable ngl',
  'quick and fun',
  'this needs a leaderboard war',
  'the loop is satisfying',
  'i was not ready for that',
  'more games like this please',
  'this is lowkey nice',
  'okay i see the vision',
];

const BOT_GAME_IDEAS = [
  // tap & catch — arcade
  { title: 'Neon Tap Dash', prompt: 'Tap the glowing pads as fast as you can before the timer runs out.', category: 'Arcade', primaryTab: 'Games', interaction: 'tap' },
  { title: 'Snack Stack Sprint', prompt: 'Catch falling snacks before they hit the floor.', category: 'Arcade', primaryTab: 'Games', interaction: 'catch' },
  { title: 'Pixel Fisher', prompt: 'Catch rare pixel fish that drop from the sky during a storm.', category: 'Casual', primaryTab: 'Games', interaction: 'catch' },
  { title: 'Bubble Pop Rush', prompt: 'Pop as many color bubbles as you can in 30 seconds.', category: 'Arcade', primaryTab: 'Games', interaction: 'tap' },
  { title: 'Star Catcher', prompt: 'Tap shooting stars before they vanish.', category: 'Arcade', primaryTab: 'Games', interaction: 'tap' },
  { title: 'Coin Storm', prompt: 'Catch falling coins, dodge the bombs.', category: 'Arcade', primaryTab: 'Games', interaction: 'catch' },

  // timing — skill
  { title: 'Moon Button', prompt: 'Press the button when the orbit hits the perfect window.', category: 'Skill', primaryTab: 'Games', interaction: 'timing' },
  { title: 'Reaction Lab', prompt: 'Tap the moment the bar enters the green zone.', category: 'Skill', primaryTab: 'Games', interaction: 'timing' },
  { title: 'Pulse Lock', prompt: 'Time your taps to lock in the perfect pulse.', category: 'Skill', primaryTab: 'Games', interaction: 'timing' },
  { title: 'Sniper Window', prompt: 'One shot. Tap when the sights are locked on.', category: 'Skill', primaryTab: 'Games', interaction: 'timing' },

  // rhythm
  { title: 'Beat Lanes', prompt: 'Tap the falling notes in time with the beat.', category: 'Rhythm', primaryTab: 'Games', interaction: 'rhythm' },
  { title: 'Drumline Drop', prompt: 'Hit each pad as the note crosses the line.', category: 'Rhythm', primaryTab: 'Games', interaction: 'rhythm' },
  { title: 'Neon Beats', prompt: 'Hit perfect taps to build a glowing combo.', category: 'Rhythm', primaryTab: 'Games', interaction: 'rhythm' },

  // quiz
  { title: 'Quiz Goblin', prompt: 'Answer 5 weird trivia questions before the goblin steals your coins.', category: 'Quiz', primaryTab: 'Quiz', interaction: 'quiz' },
  { title: 'Emoji Movie Quiz', prompt: 'Guess the movie from emojis. Fast.', category: 'Quiz', primaryTab: 'Quiz', interaction: 'quiz' },
  { title: 'Brain Tease 60', prompt: 'Five quick brain teasers. Score fast.', category: 'Quiz', primaryTab: 'Quiz', interaction: 'quiz' },
  { title: 'Would You Rather', prompt: 'Two buttons. Chaotic dilemmas. Pick fast.', category: 'Quiz', primaryTab: 'Quiz', interaction: 'quiz' },

  // choice — horror / roleplay
  { title: 'Tiny Panic Room', prompt: 'Find the safe code before the lights go out.', category: 'Horror', primaryTab: 'Horror', interaction: 'choice' },
  { title: 'Ghost Texts', prompt: 'Reply to haunted messages without making the ghost angry.', category: 'Roleplay', primaryTab: 'Roleplay', interaction: 'choice' },
  { title: 'Door 13', prompt: 'Choose the right door through a cursed hallway.', category: 'Horror', primaryTab: 'Horror', interaction: 'choice' },
  { title: 'Late Night Caller', prompt: 'A stranger is texting you. Reply carefully.', category: 'Roleplay', primaryTab: 'Roleplay', interaction: 'choice' },
  { title: 'Cursed Hallway', prompt: 'Three doors per room. Pick the safe one. Five rooms deep.', category: 'Horror', primaryTab: 'Horror', interaction: 'choice' },
  { title: 'Bartender Tonight', prompt: 'Customers want a drink and an answer. Don\'t fumble it.', category: 'Roleplay', primaryTab: 'Roleplay', interaction: 'choice' },
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function int(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function slugPart(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 16);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function makeBotUsername(index) {
  const first = slugPart(pick(BOT_FIRST_NAMES));
  const vibe = slugPart(pick(BOT_VIBES));
  return `${BOT_USERNAME_PREFIX}${first}_${vibe}_${index}`;
}

function makeBotAvatar(seed) {
  const backgrounds = ['1b1b1f', '20262f', '2c1f38', '1e2e27', '312419', '4a2338', '13343b', '4d3428'];
  const skin = ['f2d3b1', 'eac393', 'd08b5b', '9c5a3c', '6b3d2a'];
  const hairColor = ['2c1b18', '5a3d2b', '8b5e3c', 'd19a66', 'f2d6b3', '8b1e3f', '4c6a92'];
  const hair = ['short01', 'short02', 'short03', 'short04', 'short05', 'short06', 'long01', 'long02', 'long03', 'long04'];
  const variant = () => `variant${String(int(1, 8)).padStart(2, '0')}`;
  const qs = new URLSearchParams({
    bg: pick(backgrounds),
    skinColor: pick(skin),
    hairColor: pick(hairColor),
    eyes: variant(),
    eyebrows: variant(),
    mouth: variant(),
    hair: pick(hair),
    accessory: pick(['blank', 'blank', 'glasses', 'sunglasses']),
  });
  return `dicebear://${encodeURIComponent(seed)}?${qs.toString()}`;
}

// ─────────────────────────────────────────────────────────────
// V2 BOT GAME TEMPLATES
// Each interaction type renders a distinct, playable mini-game.
// All templates share the same shell helpers below so the feed
// has visual variety even before real AI generation kicks in.
// ─────────────────────────────────────────────────────────────

function gameShell({
  title,
  prompt,
  bgGradient,
  glow,
  accent,
  body,
  styles = '',
  scripts = '',
}) {
  const safeTitle = escapeHtml(title);
  const safePrompt = escapeHtml(prompt);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>${safeTitle}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #050505; color: white;
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "SF Pro Text", sans-serif; user-select: none; }
    .stage { position: relative; min-height: 100%; display: flex; flex-direction: column;
      background: radial-gradient(circle at 50% 18%, ${glow}, transparent 38%), ${bgGradient}; padding: 22px; }
    .hud { display: flex; justify-content: space-between; align-items: center; font-size: 14px; color: #d8d8e2; opacity: 0.92; }
    .hud .right { display: flex; gap: 10px; align-items: center; }
    .hud .pill { padding: 6px 12px; border-radius: 999px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.08); font-weight: 700; }
    h1 { font-size: 30px; margin: 12px 0 6px; letter-spacing: -0.04em; line-height: 1.1; }
    .sub { color: #c8c8d6; line-height: 1.45; margin: 0 0 18px; max-width: 340px; font-size: 14px; }
    .end { position: absolute; inset: 0; background: rgba(5,5,5,0.86); display: none; flex-direction: column;
      align-items: center; justify-content: center; padding: 30px; text-align: center; backdrop-filter: blur(6px); }
    .end.show { display: flex; }
    .end h2 { font-size: 28px; margin: 0 0 10px; }
    .end .final { font-size: 64px; font-weight: 900; margin: 4px 0 18px; color: ${accent}; }
    .btn { border: 0; border-radius: 999px; background: ${accent}; color: white; font-weight: 800; font-size: 16px;
      padding: 14px 22px; box-shadow: 0 18px 40px ${accent}55; cursor: pointer; }
    ${styles}
  </style>
</head>
<body>
  <main class="stage" id="stage">
    <header class="hud">
      <div class="pill" id="hudLeft">Score 0</div>
      <div class="right"><span class="pill" id="hudRight">Ready</span></div>
    </header>
    <h1>${safeTitle}</h1>
    <p class="sub">${safePrompt}</p>
    ${body}
    <div class="end" id="end">
      <h2 id="endTitle">Round Over</h2>
      <div class="final" id="endScore">0</div>
      <button class="btn" id="restart">Play again</button>
    </div>
  </main>
  <script>
    (function(){
      const hudLeft = document.getElementById('hudLeft');
      const hudRight = document.getElementById('hudRight');
      const endEl = document.getElementById('end');
      const endTitle = document.getElementById('endTitle');
      const endScore = document.getElementById('endScore');
      const restart = document.getElementById('restart');
      window.GT = {
        setScore(label, value){ hudLeft.textContent = (label||'Score') + ' ' + value; },
        setStatus(text){ hudRight.textContent = text; },
        finish({ title, score }) {
          endTitle.textContent = title || 'Round Over';
          endScore.textContent = String(score ?? '');
          endEl.classList.add('show');
        },
        onRestart(fn){ restart.addEventListener('click', () => { endEl.classList.remove('show'); fn && fn(); }); },
        rand(min, max){ return Math.floor(Math.random() * (max - min + 1)) + min; },
        haptic(){ if (navigator.vibrate) navigator.vibrate(8); },
      };
      ${scripts}
    })();
  </script>
</body>
</html>`;
}

function makeTapGame({ title, prompt }) {
  return gameShell({
    title, prompt,
    bgGradient: 'linear-gradient(160deg, #1a0a2e, #0a0014)',
    glow: '#7c3aed55',
    accent: '#a855f7',
    styles: `
      .pad-grid { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 8px; }
      .pad { aspect-ratio: 1/1; border-radius: 22px; background: rgba(168,85,247,0.16); border: 1px solid rgba(168,85,247,0.35); display: flex; align-items: center; justify-content: center; font-size: 28px; transition: transform 80ms ease; }
      .pad.live { background: radial-gradient(circle at 50% 50%, #a855f7, #6d28d9); box-shadow: 0 0 40px #a855f7aa; }
      .pad.live:active { transform: scale(0.94); }
    `,
    body: `<div class="pad-grid" id="grid">${Array.from({ length: 9 }, (_, i) => `<div class="pad" data-i="${i}">·</div>`).join('')}</div>`,
    scripts: `
      let score = 0, time = 30, live = -1, alive = true;
      const pads = Array.from(document.querySelectorAll('.pad'));
      function spawn(){ if (!alive) return; if (live >= 0) pads[live].classList.remove('live');
        live = GT.rand(0, 8); pads[live].classList.add('live');
        pads[live].textContent = ['◉','✦','◆','✺','✷'][GT.rand(0,4)];
        setTimeout(spawn, GT.rand(550, 950)); }
      pads.forEach(p => p.addEventListener('click', () => {
        if (!alive) return; const i = +p.dataset.i;
        if (i === live) { score += 1; GT.haptic(); GT.setScore('Score', score); p.classList.remove('live'); p.textContent = '·'; live = -1; }
        else { score = Math.max(0, score - 1); GT.setScore('Score', score); }
      }));
      function tick(){ if (!alive) return; time -= 1; GT.setStatus(time + 's');
        if (time <= 0) { alive = false; GT.finish({ title: 'Time!', score }); return; }
        setTimeout(tick, 1000); }
      GT.setStatus('30s'); spawn(); tick();
      GT.onRestart(() => { score = 0; time = 30; alive = true; GT.setScore('Score', 0); GT.setStatus('30s'); spawn(); tick(); });
    `,
  });
}

function makeTimingGame({ title, prompt }) {
  return gameShell({
    title, prompt,
    bgGradient: 'linear-gradient(160deg, #001a2e, #000910)',
    glow: '#06b6d455',
    accent: '#06b6d4',
    styles: `
      .arena { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 26px; }
      .track { width: 92%; height: 24px; background: rgba(6,182,212,0.16); border-radius: 999px; position: relative; overflow: hidden; }
      .zone { position: absolute; top: 0; bottom: 0; background: rgba(34,197,94,0.5); border-left: 2px solid #22c55e; border-right: 2px solid #22c55e; }
      .ind { position: absolute; top: -3px; bottom: -3px; width: 6px; background: white; border-radius: 4px; box-shadow: 0 0 16px white; transition: left 16ms linear; }
      .tap { width: 70%; aspect-ratio: 5/2; border-radius: 22px; background: linear-gradient(160deg, #06b6d4, #0e7490); color: white; font-size: 22px; font-weight: 800; display: flex; align-items: center; justify-content: center; box-shadow: 0 18px 40px #06b6d455; }
      .tap:active { transform: scale(0.97); }
    `,
    body: `<div class="arena">
      <div class="track" id="track">
        <div class="zone" id="zone"></div>
        <div class="ind" id="ind" style="left:0%"></div>
      </div>
      <div class="tap" id="tap">TAP</div>
    </div>`,
    scripts: `
      let score = 0, lives = 3, alive = true;
      const ind = document.getElementById('ind');
      const zoneEl = document.getElementById('zone');
      let zoneStart = 40, zoneEnd = 60, dir = 1, pos = 0, speed = 1.4;
      function placeZone(){ const w = 14 + Math.max(0, 8 - score * 0.4); zoneStart = GT.rand(15, 75); zoneEnd = zoneStart + w;
        zoneEl.style.left = zoneStart + '%'; zoneEl.style.width = (zoneEnd - zoneStart) + '%'; }
      placeZone();
      function loop(){ if (!alive) return; pos += dir * speed; if (pos >= 100){ pos = 100; dir = -1; } if (pos <= 0){ pos = 0; dir = 1; }
        ind.style.left = pos + '%'; requestAnimationFrame(loop); }
      loop();
      document.getElementById('tap').addEventListener('click', () => {
        if (!alive) return;
        if (pos >= zoneStart && pos <= zoneEnd) { score += 1; speed += 0.18; GT.setScore('Score', score); GT.haptic(); placeZone(); }
        else { lives -= 1; GT.setStatus('Lives ' + lives); if (lives <= 0) { alive = false; GT.finish({ title: 'Out of lives', score }); } }
      });
      GT.setStatus('Lives 3');
      GT.onRestart(() => { score = 0; lives = 3; speed = 1.4; alive = true; GT.setScore('Score', 0); GT.setStatus('Lives 3'); placeZone(); loop(); });
    `,
  });
}

function makeQuizGame({ title, prompt }) {
  const QUESTIONS = [
    { q: 'Which planet has the most moons?', a: ['Mars', 'Saturn', 'Earth', 'Mercury'], c: 1 },
    { q: 'Octopuses have how many hearts?', a: ['1', '2', '3', '4'], c: 2 },
    { q: 'What does HTTP stand for?', a: ['Hyper Text Transfer Protocol', 'Home Tool Transfer Protocol', 'Hyperlink Text Transit Plan', 'High Traffic Test Protocol'], c: 0 },
    { q: 'Tallest mountain in the solar system?', a: ['Everest', 'K2', 'Olympus Mons', 'Denali'], c: 2 },
    { q: 'Which language did Java NOT inspire?', a: ['JavaScript', 'C', 'Kotlin', 'Scala'], c: 1 },
    { q: 'What\'s the capital of Mongolia?', a: ['Ulaanbaatar', 'Astana', 'Tashkent', 'Bishkek'], c: 0 },
    { q: 'A baby kangaroo is called a?', a: ['Pup', 'Joey', 'Kit', 'Calf'], c: 1 },
    { q: 'Bitcoin was invented in?', a: ['2005', '2009', '2013', '2017'], c: 1 },
    { q: 'Which one is a real Pokémon?', a: ['Snorlax', 'Snortax', 'Snortlex', 'Snorlex'], c: 0 },
    { q: 'Which gas do plants release?', a: ['CO2', 'Nitrogen', 'Oxygen', 'Methane'], c: 2 },
  ];
  const picked = [...QUESTIONS].sort(() => Math.random() - 0.5).slice(0, 5);
  const data = JSON.stringify(picked);
  return gameShell({
    title, prompt,
    bgGradient: 'linear-gradient(160deg, #2a1500, #100700)',
    glow: '#f59e0b55',
    accent: '#f59e0b',
    styles: `
      .question { margin-top: 8px; padding: 16px; border-radius: 18px; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.25); font-size: 18px; font-weight: 700; min-height: 90px; }
      .answers { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
      .ans { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); padding: 14px; border-radius: 14px; font-size: 15px; cursor: pointer; min-height: 64px; display: flex; align-items: center; justify-content: center; text-align: center; }
      .ans.right { background: #16a34a; border-color: #16a34a; }
      .ans.wrong { background: #dc2626; border-color: #dc2626; }
    `,
    body: `<div class="question" id="q">Loading...</div><div class="answers" id="answers"></div>`,
    scripts: `
      const QS = ${data};
      let idx = 0, score = 0;
      const qEl = document.getElementById('q');
      const aEl = document.getElementById('answers');
      function render(){ if (idx >= QS.length){ GT.finish({ title: idx + ' / ' + QS.length, score }); return; }
        const cur = QS[idx]; qEl.textContent = (idx+1) + '. ' + cur.q; aEl.innerHTML='';
        cur.a.forEach((opt, i) => { const b = document.createElement('div'); b.className = 'ans'; b.textContent = opt;
          b.addEventListener('click', () => { const ok = i === cur.c; b.classList.add(ok ? 'right' : 'wrong');
            if (ok) { score += 20; GT.setScore('Score', score); GT.haptic(); }
            setTimeout(() => { idx++; render(); }, 650);
          }); aEl.appendChild(b); });
        GT.setStatus('Q ' + (idx+1) + '/' + QS.length); }
      render();
      GT.onRestart(() => { idx = 0; score = 0; GT.setScore('Score', 0); render(); });
    `,
  });
}

function makeChoiceGame({ title, prompt }) {
  const ROOMS = [
    { text: 'Lights flicker. Three doors hum.', doors: ['Left', 'Center', 'Right'], safe: int(0, 2) },
    { text: 'A whisper crawls past your ear. Choose.', doors: ['Stairs', 'Closet', 'Window'], safe: int(0, 2) },
    { text: 'Three numbers glow. Only one is real.', doors: ['7', '13', '21'], safe: int(0, 2) },
    { text: 'A figure points at three masks.', doors: ['Crow', 'Fox', 'Moth'], safe: int(0, 2) },
    { text: 'The phone rings. Pick the right answer.', doors: ['"Hello?"', 'Hang up', '"Who is this?"'], safe: int(0, 2) },
  ];
  const roomData = JSON.stringify(ROOMS);
  return gameShell({
    title, prompt,
    bgGradient: 'linear-gradient(160deg, #1c0204, #050000)',
    glow: '#ef444455',
    accent: '#ef4444',
    styles: `
      .scene { margin-top: 10px; padding: 18px; border-radius: 18px; background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.2); font-size: 18px; min-height: 100px; line-height: 1.4; }
      .doors { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 14px; }
      .door { background: rgba(255,255,255,0.05); border: 1px solid rgba(239,68,68,0.25); padding: 18px 8px; border-radius: 14px; font-size: 15px; text-align: center; cursor: pointer; min-height: 80px; display: flex; align-items: center; justify-content: center; }
      .door.right { background: #16a34a; border-color: #16a34a; }
      .door.wrong { background: #b91c1c; border-color: #b91c1c; }
    `,
    body: `<div class="scene" id="scene">...</div><div class="doors" id="doors"></div>`,
    scripts: `
      const ROOMS = ${roomData};
      let idx = 0, score = 0, alive = true;
      const sceneEl = document.getElementById('scene');
      const doorsEl = document.getElementById('doors');
      function render(){ if (!alive) return;
        if (idx >= ROOMS.length) { GT.finish({ title: 'You made it.', score }); return; }
        const r = ROOMS[idx]; sceneEl.textContent = r.text; doorsEl.innerHTML = '';
        r.doors.forEach((label, i) => { const d = document.createElement('div'); d.className = 'door'; d.textContent = label;
          d.addEventListener('click', () => { const ok = i === r.safe; d.classList.add(ok ? 'right' : 'wrong');
            if (ok) { score += 20; GT.setScore('Score', score); GT.haptic(); setTimeout(() => { idx++; render(); }, 600); }
            else { alive = false; setTimeout(() => GT.finish({ title: 'Wrong door.', score }), 700); }
          }); doorsEl.appendChild(d); });
        GT.setStatus('Room ' + (idx+1) + '/' + ROOMS.length); }
      render();
      GT.onRestart(() => { idx = 0; score = 0; alive = true; GT.setScore('Score', 0); render(); });
    `,
  });
}

function makeRhythmGame({ title, prompt }) {
  return gameShell({
    title, prompt,
    bgGradient: 'linear-gradient(160deg, #042810, #00150a)',
    glow: '#22c55e55',
    accent: '#22c55e',
    styles: `
      .lanes { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; position: relative; margin-top: 8px; min-height: 360px; }
      .lane { position: relative; background: rgba(34,197,94,0.06); border: 1px solid rgba(34,197,94,0.2); border-radius: 18px; overflow: hidden; }
      .note { position: absolute; left: 8px; right: 8px; height: 32px; border-radius: 10px; background: linear-gradient(160deg, #22c55e, #15803d); box-shadow: 0 0 18px #22c55eaa; top: -40px; }
      .hitline { position: absolute; left: 0; right: 0; bottom: 64px; height: 4px; background: rgba(255,255,255,0.6); }
      .keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }
      .key { padding: 18px 8px; border-radius: 14px; background: rgba(34,197,94,0.18); border: 1px solid rgba(34,197,94,0.4); font-weight: 800; text-align: center; cursor: pointer; }
      .key:active { transform: scale(0.97); }
    `,
    body: `<div class="lanes" id="lanes">${[0,1,2].map(i => `<div class="lane" data-i="${i}"><div class="hitline"></div></div>`).join('')}</div>
      <div class="keys" id="keys">${[0,1,2].map(i => `<div class="key" data-i="${i}">TAP</div>`).join('')}</div>`,
    scripts: `
      const lanes = Array.from(document.querySelectorAll('.lane'));
      const keys = Array.from(document.querySelectorAll('.key'));
      let score = 0, time = 35, alive = true;
      function spawn(){ if (!alive) return;
        const i = GT.rand(0, 2); const note = document.createElement('div'); note.className = 'note';
        note.dataset.lane = i; note.dataset.t = Date.now(); lanes[i].appendChild(note);
        let y = -40; const lane = lanes[i]; const interval = setInterval(() => {
          if (!note.isConnected) { clearInterval(interval); return; }
          y += 6; note.style.top = y + 'px';
          if (y > lane.clientHeight - 30) { note.remove(); clearInterval(interval); }
        }, 16);
        setTimeout(spawn, GT.rand(420, 720));
      }
      keys.forEach(k => k.addEventListener('click', () => {
        if (!alive) return; const i = +k.dataset.i;
        const note = lanes[i].querySelector('.note');
        if (note) {
          const top = parseFloat(note.style.top || '0'); const target = lanes[i].clientHeight - 96;
          const diff = Math.abs(top - target);
          if (diff < 40) { score += diff < 15 ? 30 : 15; GT.setScore('Score', score); GT.haptic(); note.remove(); }
        }
      }));
      function tick(){ if (!alive) return; time -= 1; GT.setStatus(time + 's');
        if (time <= 0) { alive = false; GT.finish({ title: 'Set!', score }); return; }
        setTimeout(tick, 1000); }
      GT.setStatus('35s'); spawn(); tick();
      GT.onRestart(() => { score = 0; time = 35; alive = true; lanes.forEach(l => l.querySelectorAll('.note').forEach(n => n.remove())); GT.setScore('Score', 0); GT.setStatus('35s'); spawn(); tick(); });
    `,
  });
}

function makeCatchGame({ title, prompt }) {
  return gameShell({
    title, prompt,
    bgGradient: 'linear-gradient(160deg, #2a1300, #100600)',
    glow: '#fb923c55',
    accent: '#fb923c',
    styles: `
      .arena { flex: 1; position: relative; margin-top: 10px; border-radius: 22px; overflow: hidden; background: radial-gradient(circle at 50% 110%, rgba(251,146,60,0.2), transparent 60%), rgba(255,255,255,0.03); border: 1px solid rgba(251,146,60,0.3); min-height: 380px; }
      .item { position: absolute; width: 44px; height: 44px; border-radius: 14px; background: linear-gradient(160deg, #fb923c, #c2410c); box-shadow: 0 0 18px #fb923caa; display: flex; align-items: center; justify-content: center; font-size: 20px; }
      .item.bomb { background: linear-gradient(160deg, #1f2937, #0b0f17); box-shadow: 0 0 18px #1f2937aa; }
      .floor { position: absolute; bottom: 0; left: 0; right: 0; height: 6px; background: rgba(255,255,255,0.18); }
    `,
    body: `<div class="arena" id="arena"><div class="floor"></div></div>`,
    scripts: `
      const arena = document.getElementById('arena');
      let score = 0, lives = 3, alive = true;
      function spawn(){ if (!alive) return;
        const isBomb = Math.random() < 0.18;
        const it = document.createElement('div'); it.className = 'item' + (isBomb ? ' bomb' : '');
        it.textContent = isBomb ? '✸' : ['★','◆','✿','♦','✺'][GT.rand(0,4)];
        it.style.left = GT.rand(0, arena.clientWidth - 44) + 'px'; it.style.top = '-50px';
        arena.appendChild(it);
        let y = -50; const speed = GT.rand(3, 6);
        const fall = setInterval(() => {
          if (!it.isConnected) { clearInterval(fall); return; }
          y += speed; it.style.top = y + 'px';
          if (y > arena.clientHeight - 50) { if (!isBomb) { lives -= 1; GT.setStatus('Lives ' + lives);
              if (lives <= 0) { alive = false; GT.finish({ title: 'Spilled!', score }); } }
            it.remove(); clearInterval(fall); }
        }, 32);
        it.addEventListener('click', () => {
          if (isBomb) { lives -= 1; GT.setStatus('Lives ' + lives); GT.haptic();
            if (lives <= 0) { alive = false; GT.finish({ title: 'Bomb!', score }); } }
          else { score += 5; GT.setScore('Score', score); GT.haptic(); }
          it.remove(); clearInterval(fall);
        });
        setTimeout(spawn, GT.rand(500, 850));
      }
      GT.setStatus('Lives 3'); spawn();
      GT.onRestart(() => { score = 0; lives = 3; alive = true; arena.querySelectorAll('.item').forEach(n => n.remove());
        GT.setScore('Score', 0); GT.setStatus('Lives 3'); spawn(); });
    `,
  });
}

function makeBotGameHtml({ title, prompt, interaction }) {
  const kind = String(interaction || 'tap').toLowerCase();
  switch (kind) {
    case 'timing': return makeTimingGame({ title, prompt });
    case 'quiz': return makeQuizGame({ title, prompt });
    case 'choice': return makeChoiceGame({ title, prompt });
    case 'rhythm': return makeRhythmGame({ title, prompt });
    case 'catch': return makeCatchGame({ title, prompt });
    case 'tap':
    default: return makeTapGame({ title, prompt });
  }
}

function requireBotAdmin(req, res, next) {
  const secret = process.env.BOT_ADMIN_SECRET || process.env.ADMIN_SECRET;
  // In dev/local, allow admin routes without a secret.
  if (process.env.NODE_ENV !== 'production' && !secret) return next();
  if (secret && req.headers['x-admin-secret'] !== secret) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  if (process.env.NODE_ENV === 'production' && !secret) {
    return res.status(403).json({ error: 'BOT_ADMIN_SECRET is required in production' });
  }
  next();
}

export async function ensureBotTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_profiles (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      persona TEXT NOT NULL,
      taste_tags JSONB DEFAULT '[]'::jsonb,
      activity_level INTEGER DEFAULT 3,
      last_active_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bot_engine_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      action_count INTEGER DEFAULT 0,
      result JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_bot_profiles_last_active ON bot_profiles(last_active_at);
    CREATE INDEX IF NOT EXISTS idx_bot_engine_runs_created ON bot_engine_runs(created_at DESC);
  `);
}

export async function getBotStatus() {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM bot_profiles) AS bots,
      (SELECT COUNT(*)::int FROM users u JOIN bot_profiles bp ON bp.user_id = u.id) AS bot_users,
      (SELECT COUNT(*)::int FROM games g WHERE g.developer IN (SELECT user_id::text FROM bot_profiles)) AS bot_games,
      (SELECT COUNT(*)::int FROM likes l JOIN bot_profiles bp ON bp.user_id = l.user_id) AS bot_likes,
      (SELECT COUNT(*)::int FROM comments c JOIN bot_profiles bp ON bp.user_id = c.user_id) AS bot_comments,
      (SELECT COUNT(*)::int FROM scores s JOIN bot_profiles bp ON bp.user_id = s.user_id) AS bot_scores,
      (SELECT COUNT(*)::int FROM followers f JOIN bot_profiles bp ON bp.user_id = f.follower_id) AS bot_follows,
      (SELECT created_at FROM bot_engine_runs ORDER BY created_at DESC LIMIT 1) AS last_run_at
  `);
  return result.rows[0];
}

export async function seedBots({ targetCount = 10000, onProgress } = {}) {
  await ensureBotTables();
  const current = await pool.query('SELECT COUNT(*)::int AS count FROM bot_profiles');
  const existingCount = current.rows[0]?.count || 0;
  const toCreate = Math.max(0, targetCount - existingCount);
  if (toCreate === 0) {
    return { created: 0, existing: existingCount, target: targetCount };
  }

  let created = 0;
  const progressEvery = Math.max(50, Math.floor(toCreate / 20));
  for (let i = 0; i < toCreate; i += 1) {
    const index = existingCount + i + 1;
    const username = makeBotUsername(index);
    const displayName = `${pick(BOT_FIRST_NAMES)} ${pick(['plays', 'arcade', 'loops', 'tok', 'bits', 'dash'])}`;
    const persona = pick(BOT_VIBES);
    const avatar = makeBotAvatar(username);
    const email = `${username}@${BOT_EMAIL_DOMAIN}`;
    const token = `bot_${randomUUID()}`;
    const bio = pick(BOT_BIOS);
    const activityLevel = int(1, 5);
    const tasteTags = [persona, pick(['arcade', 'horror', 'quiz', 'roleplay', 'casual', 'skill'])];

    const inserted = await pool.query(
      `INSERT INTO users (username, email, password, display_name, avatar, bio, token, email_verified, games_played, total_score)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, TRUE, $7, $8)
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
      [username, email, displayName, avatar, bio, token, int(0, 80), int(0, 50000)]
    );
    const userId = inserted.rows[0]?.id;
    if (!userId) continue;

    await pool.query(
      `INSERT INTO bot_profiles (user_id, persona, taste_tags, activity_level, last_active_at)
       VALUES ($1, $2, $3, $4, NOW() - ($5 || ' hours')::interval)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, persona, JSON.stringify(tasteTags), activityLevel, int(1, 240)]
    );
    created += 1;

    if (created % progressEvery === 0 && typeof onProgress === 'function') {
      onProgress({ created, total: toCreate });
    }
  }

  return { created, existing: existingCount, target: targetCount };
}

async function getRandomBots(limit) {
  const result = await pool.query(
    `SELECT u.id, u.username, u.display_name, bp.persona, bp.activity_level
     FROM bot_profiles bp
     JOIN users u ON u.id = bp.user_id
     ORDER BY RANDOM()
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

async function getRandomGames(limit) {
  const result = await pool.query(
    `SELECT id, name, category, primary_tab
     FROM games
     WHERE multiplayer_only = FALSE OR multiplayer_only IS NULL
     ORDER BY RANDOM()
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

async function botLikeGame(bot, game) {
  const result = await pool.query(
    `WITH inserted AS (
       INSERT INTO likes (user_id, game_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING game_id
     )
     UPDATE games
        SET like_count = COALESCE(like_count, 0) + (SELECT COUNT(*) FROM inserted)
      WHERE id = $2
      RETURNING (SELECT COUNT(*)::int FROM inserted) AS inserted`,
    [bot.id, game.id]
  );
  await pool.query('UPDATE bot_profiles SET last_active_at = NOW() WHERE user_id = $1', [bot.id]);
  return result.rows[0]?.inserted ? 1 : 0;
}

async function botCommentGame(bot, game) {
  const comment = pick(BOT_COMMENTS);
  await pool.query(
    `INSERT INTO comments (game_id, user_id, text, likes, created_at)
     VALUES ($1, $2, $3, $4, NOW() - ($5 || ' minutes')::interval)`,
    [game.id, bot.id, comment, int(0, 8), int(0, 90)]
  );
  await pool.query('UPDATE bot_profiles SET last_active_at = NOW() WHERE user_id = $1', [bot.id]);
  return 1;
}

async function botPlayGame(bot, game) {
  await pool.query(
    `INSERT INTO game_plays (user_id, game_id, play_count, first_played_at, last_played_at)
     VALUES ($1, $2, 1, NOW(), NOW())
     ON CONFLICT (user_id, game_id)
     DO UPDATE SET play_count = game_plays.play_count + 1, last_played_at = NOW()`,
    [bot.id, game.id]
  );
  await pool.query('UPDATE games SET plays = COALESCE(plays, 0) + 1 WHERE id = $1', [game.id]);
  await pool.query('UPDATE users SET games_played = COALESCE(games_played, 0) + 1 WHERE id = $1', [bot.id]);
  await pool.query('UPDATE bot_profiles SET last_active_at = NOW() WHERE user_id = $1', [bot.id]);
  return 1;
}

async function botScoreGame(bot, game) {
  const score = int(80, 25000);
  await pool.query(
    `INSERT INTO scores (user_id, game_id, score, created_at)
     VALUES ($1, $2, $3, NOW() - ($4 || ' minutes')::interval)`,
    [bot.id, game.id, score, int(0, 120)]
  );
  await pool.query(
    `INSERT INTO game_plays (user_id, game_id, play_count, first_played_at, last_played_at)
     VALUES ($1, $2, 1, NOW(), NOW())
     ON CONFLICT (user_id, game_id)
     DO UPDATE SET play_count = game_plays.play_count + 1, last_played_at = NOW()`,
    [bot.id, game.id]
  );
  await pool.query('UPDATE games SET plays = COALESCE(plays, 0) + 1 WHERE id = $1', [game.id]);
  await pool.query(
    'UPDATE users SET games_played = COALESCE(games_played, 0) + 1, total_score = COALESCE(total_score, 0) + $2 WHERE id = $1',
    [bot.id, score]
  );
  await pool.query('UPDATE bot_profiles SET last_active_at = NOW() WHERE user_id = $1', [bot.id]);
  return 1;
}

async function botFollow(bot) {
  const target = await pool.query(
    `SELECT u.id
     FROM users u
     WHERE u.id != $1
       AND NOT EXISTS (
         SELECT 1 FROM followers f WHERE f.follower_id = $1 AND f.following_id = u.id
       )
     ORDER BY RANDOM()
     LIMIT 1`,
    [bot.id]
  );
  const targetId = target.rows[0]?.id;
  if (!targetId) return 0;

  await pool.query(
    'INSERT INTO followers (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [bot.id, targetId]
  );
  await pool.query('UPDATE bot_profiles SET last_active_at = NOW() WHERE user_id = $1', [bot.id]);
  return 1;
}

// ─────────────────────────────────────────────────────────────
// Persona-driven prompts for the REAL DreamStream pipeline.
// These mirror what a human player typing in the AI maker would write.
// ─────────────────────────────────────────────────────────────
const BOT_DREAM_PROMPTS = {
  arcade: [
    'A neon arcade game where you tap glowing lanes to the beat and chain combos before the energy bar drops.',
    'A pixel runner that auto-scrolls through a candy city while you swipe to dodge falling cupcakes.',
    'A one-button reflex game: hold to charge a slingshot and release to launch a tiny astronaut between asteroids.',
  ],
  horror: [
    'A creepy hallway game: every few seconds a door opens, you tap the safe one before the lights go out, three lives, getting harder each round.',
    'A short text-message horror where you reply to a haunted contact, wrong replies make the screen glitch and pull you closer to the ghost.',
    'A flashlight survival mini-game where you sweep a beam across a dark room to find keys before something behind you whispers your name.',
  ],
  quiz: [
    'A trivia goblin game: a goblin asks weird pop culture questions, three wrong answers and he steals your coins, with a streak multiplier.',
    'A fast-fire emoji quiz: guess the movie from 4 emojis in 7 seconds, score-based.',
    'A "would you rather" speed quiz with two buttons and chaotic dilemmas, every answer raises the chaos meter.',
  ],
  rhythm: [
    'A rhythm tap game: notes fly down 3 lanes to a chiptune beat, perfect taps build a glowing combo trail.',
    'A drum machine puzzle where you tap pads in sync to recreate a sample loop, scored by accuracy.',
    'A neon dance floor where you tap arrows in time with the kick drum to keep the crowd hyped.',
  ],
  puzzle: [
    'A tiny block-fitting puzzle where you drag shapes onto a grid, chain rows for combos, lose if grid fills.',
    'A color-flow puzzle: connect matching dots without crossing lines, levels get tighter every round.',
    'A word-rotate puzzle: rotate a 3x3 grid of letters to find as many words as possible in 60 seconds.',
  ],
  roleplay: [
    'A short roleplay text game where you choose between three responses to a charming stranger, with a relationship meter.',
    'A "haunted texts" roleplay: reply to messages from a mysterious caller, each branch leads to a different ending.',
    'A bartender roleplay: customers tell you their problems, pick the right drink and reply to keep the bar happy.',
  ],
  casual: [
    'A pixel fishing game: tap to cast, reel in fish before they escape, rare fish during storms double your score.',
    'A snack stacker: stack falling snacks on a tiny tray as high as you can without toppling.',
    'A relaxing zen tap garden: tap leaves to grow a tree, chain taps to make wind sweep through it.',
  ],
  skill: [
    'A precision-timing button game: hit the button when an orbiting moon crosses a window, get tighter windows with each round.',
    'A reaction game: tap when a sound plays, ignore decoys, your average reaction time is your score.',
    'A balance game: tilt a tiny bar with two side buttons to keep a rolling marble centered as it speeds up.',
  ],
};

const PERSONA_TO_LANE = {
  'arcade kid': { tab: 'Games', cat: 'arcade', interaction: 'tap' },
  speedrunner: { tab: 'Games', cat: 'skill', interaction: 'timing' },
  'cozy gamer': { tab: 'Games', cat: 'casual', interaction: 'tap' },
  'horror fan': { tab: 'Horror', cat: 'horror', interaction: 'choice' },
  'quiz brain': { tab: 'Quiz', cat: 'quiz', interaction: 'quiz' },
  'rhythm addict': { tab: 'Games', cat: 'rhythm', interaction: 'timing' },
  'high score hunter': { tab: 'Games', cat: 'arcade', interaction: 'tap' },
  'puzzle goblin': { tab: 'Games', cat: 'puzzle', interaction: 'choice' },
  'chaos player': { tab: 'Games', cat: 'arcade', interaction: 'tap' },
  'retro enjoyer': { tab: 'Games', cat: 'arcade', interaction: 'tap' },
  'platformer fan': { tab: 'Games', cat: 'skill', interaction: 'timing' },
  'party game person': { tab: 'Quiz', cat: 'quiz', interaction: 'quiz' },
  'casual grinder': { tab: 'Games', cat: 'casual', interaction: 'tap' },
  'tiny game critic': { tab: 'Games', cat: 'puzzle', interaction: 'choice' },
  collector: { tab: 'Games', cat: 'casual', interaction: 'tap' },
  'boss fight lover': { tab: 'Games', cat: 'skill', interaction: 'timing' },
};

function makePersonaPrompt(bot) {
  const persona = String(bot.persona || '').toLowerCase();
  const lane = PERSONA_TO_LANE[persona] || PERSONA_TO_LANE['arcade kid'];
  const bucket =
    BOT_DREAM_PROMPTS[lane.cat] ||
    BOT_DREAM_PROMPTS.arcade;
  const seed = pick(bucket);
  const prompt = `${seed}

Make it a complete playable mobile web game with a clear win/lose condition, scoring, difficulty progression, and controls that match the idea. Do not make a generic "tap to score" button game unless the concept specifically requires tapping.`;
  return { prompt, lane };
}

async function waitForDreamReady(jobId, { timeoutMs = 5 * 60_000, pollMs = 4000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await pool.query(
      'SELECT id, user_id, title, prompt, html_payload, raw_code, thumbnail, preview_video_url, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips FROM ai_games WHERE id = $1',
      [jobId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('Dream draft row disappeared');
    }
    if (row.title && String(row.title).startsWith('ERROR:')) {
      throw new Error(row.title.replace('ERROR: ', ''));
    }
    if (row.html_payload && row.html_payload.length > 0) {
      return row;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error('Dream job timed out');
}

// Run ONE bot through the same DreamStream pipeline a real user uses, then publish.
// This is heavy: it invokes the real AI builder. Use sparingly.
export async function botDreamGame(bot) {
  if (!bot?.id) throw new Error('bot.id required');
  const { prompt } = makePersonaPrompt(bot);
  const jobId = randomUUID();

  await createPendingJob(bot.id, prompt, 'DreamStream Pending...', jobId);

  // Run the real pipeline. executeDreamJob handles its own errors by writing
  // ERROR: ... into the title, so we still need to surface that.
  await executeDreamJob(jobId, prompt, []);

  const draft = await waitForDreamReady(jobId, { timeoutMs: 6 * 60_000 });

  // Publish as the bot. Mirrors what /api/ai/publish/:draftId does for users.
  await pool.query(
    'UPDATE ai_games SET is_draft = FALSE WHERE id = $1 AND user_id = $2',
    [jobId, bot.id]
  );
  const { globalId, classification } = await upsertPublishedAIGame({
    draftId: jobId,
    userId: bot.id,
    draft,
  });

  await pool.query('UPDATE bot_profiles SET last_active_at = NOW() WHERE user_id = $1', [bot.id]);
  return { jobId, globalId, title: draft.title, prompt, classification };
}

export async function dreamBotGames({ count = 1, concurrency = 1 } = {}) {
  await ensureBotTables();
  const safeCount = Math.max(1, Math.min(50, Number(count) || 1));
  const safeConcurrency = Math.max(1, Math.min(3, Number(concurrency) || 1));
  const bots = await getRandomBots(safeCount);
  if (!bots.length) return { created: 0, reason: 'no_bots' };

  const stats = { created: 0, errors: [], games: [] };
  for (let i = 0; i < bots.length; i += safeConcurrency) {
    const batch = bots.slice(i, i + safeConcurrency);
    const results = await Promise.allSettled(batch.map((bot) => botDreamGame(bot)));
    for (let j = 0; j < results.length; j += 1) {
      const r = results[j];
      const bot = batch[j];
      if (r.status === 'fulfilled') {
        stats.created += 1;
        stats.games.push({ bot: bot.username, title: r.value.title, gameId: r.value.globalId });
      } else {
        stats.errors.push({ bot: bot.username, error: r.reason?.message || String(r.reason) });
      }
    }
  }
  return stats;
}

export async function createBotGames({ count = 10 } = {}) {
  await ensureBotTables();
  const bots = await getRandomBots(Math.max(count, 1));
  if (!bots.length) return { created: 0, reason: 'no_bots' };

  let created = 0;
  for (let i = 0; i < count; i += 1) {
    const bot = bots[i % bots.length];
    const idea = pick(BOT_GAME_IDEAS);
    const draftId = randomUUID();
    const title = `${idea.title} ${int(1, 99)}`;
    const prompt = idea.prompt;
    const html = makeBotGameHtml({ title, prompt, interaction: idea.interaction });
    const globalId = `gm-ai-${String(draftId).substring(0, 8)}`;
    const tags = [idea.interaction, idea.category.toLowerCase(), 'quick'];
    const chips = [idea.category, idea.interaction, 'Quick'];

    await pool.query(
      `INSERT INTO ai_games
        (id, user_id, prompt, title, html_payload, raw_code, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips, is_draft, created_at)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, 0.72, $10, $11, FALSE, NOW() - ($12 || ' hours')::interval)`,
      [
        draftId,
        bot.id,
        prompt,
        title,
        html,
        idea.category,
        idea.category.toLowerCase(),
        idea.primaryTab,
        idea.interaction,
        JSON.stringify(tags),
        JSON.stringify(chips),
        int(0, 96),
      ]
    );

    await pool.query(
      `INSERT INTO games
        (id, name, description, icon, color, category, subcategory, primary_tab, interaction_type, classification_confidence, classification_tags, discovery_chips, developer, embed_url, plays, like_count, created_at)
       VALUES ($1, $2, $3, '✨', '#050505', $4, $5, $6, $7, 0.72, $8, $9, $10, $11, $12, $13, NOW() - ($14 || ' hours')::interval)
       ON CONFLICT (id) DO NOTHING`,
      [
        globalId,
        title,
        `AI Creation: ${prompt}`,
        idea.category,
        idea.category.toLowerCase(),
        idea.primaryTab,
        idea.interaction,
        JSON.stringify(tags),
        JSON.stringify(chips),
        bot.id,
        `/api/ai/play/${draftId}`,
        int(5, 250),
        int(0, 30),
        int(0, 96),
      ]
    );

    await pool.query('UPDATE bot_profiles SET last_active_at = NOW() WHERE user_id = $1', [bot.id]);
    created += 1;
  }

  return { created };
}

// Refresh the html_payload of existing bot-authored games to use the V2
// multi-template renderer. Existing V1 bot games are all "tap to score";
// this rewrites them so the feed actually plays differently per game.
// Skips real DreamStream-generated games (those have rich HTML we don't want to clobber).
export async function regenerateBotGameHtml({ limit = 200, onProgress } = {}) {
  await ensureBotTables();
  const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 200));

  const rows = await pool.query(
    `SELECT ag.id AS draft_id, ag.title, ag.prompt, ag.interaction_type,
            ag.html_payload, ag.user_id,
            g.id AS game_id, g.embed_url
     FROM ai_games ag
     JOIN bot_profiles bp ON bp.user_id = ag.user_id
     LEFT JOIN games g ON g.developer = ag.user_id::text AND g.embed_url = ('/api/ai/play/' || ag.id::text)
     WHERE ag.is_draft = FALSE
       AND ag.html_payload IS NOT NULL
       AND length(ag.html_payload) < 8000
     ORDER BY ag.created_at DESC
     LIMIT $1`,
    [safeLimit]
  );

  let updated = 0;
  for (const row of rows.rows) {
    const interaction = row.interaction_type || pick(['tap', 'timing', 'quiz', 'choice', 'rhythm', 'catch']);
    const html = makeBotGameHtml({
      title: row.title || 'Quick Game',
      prompt: row.prompt || 'Quick prototype challenge.',
      interaction,
    });
    await pool.query(
      'UPDATE ai_games SET html_payload = $1, raw_code = $1, interaction_type = $2 WHERE id = $3',
      [html, interaction, row.draft_id]
    );
    if (row.game_id) {
      await pool.query(
        'UPDATE games SET interaction_type = $1 WHERE id = $2',
        [interaction, row.game_id]
      );
    }
    updated += 1;
    if (typeof onProgress === 'function' && updated % 20 === 0) {
      onProgress({ updated, total: rows.rows.length });
    }
  }
  return { updated, total: rows.rows.length };
}

export async function runBotActivityTick({ actions = 100, createGames = false } = {}) {
  await ensureBotTables();
  const bots = await getRandomBots(Math.max(1, Math.min(actions, 250)));
  const games = await getRandomGames(Math.max(10, Math.min(actions, 250)));
  if (!bots.length) return { actions: 0, reason: 'no_bots' };
  if (!games.length) return { actions: 0, reason: 'no_games' };

  const stats = { likes: 0, comments: 0, plays: 0, scores: 0, follows: 0, games: 0, skipped: 0 };
  const maxGameCreates = createGames ? Math.max(1, Math.floor(actions / 50)) : 0;

  for (let i = 0; i < actions; i += 1) {
    const bot = pick(bots);
    const game = pick(games);
    const roll = Math.random();
    try {
      if (createGames && stats.games < maxGameCreates && roll > 0.97) {
        const res = await createBotGames({ count: 1 });
        stats.games += res.created || 0;
      } else if (roll < 0.36) {
        stats.plays += await botPlayGame(bot, game);
      } else if (roll < 0.58) {
        stats.scores += await botScoreGame(bot, game);
      } else if (roll < 0.78) {
        stats.likes += await botLikeGame(bot, game);
      } else if (roll < 0.92) {
        stats.comments += await botCommentGame(bot, game);
      } else {
        stats.follows += await botFollow(bot);
      }
    } catch (error) {
      stats.skipped += 1;
      console.log('[BotEngine] Action skipped:', error.message);
    }
  }

  const actionCount = stats.likes + stats.comments + stats.plays + stats.scores + stats.follows + stats.games;
  await pool.query(
    'INSERT INTO bot_engine_runs (action_count, result) VALUES ($1, $2)',
    [actionCount, JSON.stringify(stats)]
  );
  return { actions: actionCount, ...stats };
}

export function startBotEngineScheduler() {
  const enabled =
    process.env.BOT_ENGINE_ENABLED === 'true' ||
    (process.env.NODE_ENV !== 'production' && process.env.BOT_ENGINE_ENABLED !== 'false');
  if (!enabled) {
    console.log('[BotEngine] Scheduler disabled. Set BOT_ENGINE_ENABLED=true to enable.');
    return null;
  }

  const intervalMs = Math.max(60_000, Number(process.env.BOT_ENGINE_INTERVAL_MS || 5 * 60_000));
  const actions = Math.max(1, Math.min(1000, Number(process.env.BOT_ENGINE_ACTIONS || 50)));
  const createGames = process.env.BOT_ENGINE_CREATE_GAMES === 'true';

  const run = async () => {
    try {
      const result = await runBotActivityTick({ actions, createGames });
      console.log('[BotEngine] Tick complete:', result);
    } catch (error) {
      console.error('[BotEngine] Tick failed:', error);
    }
  };

  const timer = setInterval(run, intervalMs);
  console.log(`[BotEngine] Scheduler enabled: ${actions} actions every ${Math.round(intervalMs / 1000)}s`);
  return timer;
}

const router = express.Router();

router.use(requireBotAdmin);

router.get('/status', async (_req, res) => {
  try {
    await ensureBotTables();
    res.json({ success: true, status: await getBotStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/seed', async (req, res) => {
  try {
    const targetCount = Math.max(1, Math.min(100000, Number(req.body?.count || 10000)));
    const seed = await seedBots({ targetCount });
    const games = req.body?.games ? await createBotGames({ count: Math.min(500, Number(req.body.games)) }) : { created: 0 };
    const activity = req.body?.activity ? await runBotActivityTick({ actions: Math.min(5000, Number(req.body.activity)), createGames: false }) : null;
    res.json({ success: true, seed, games, activity, status: await getBotStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/games', async (req, res) => {
  try {
    const count = Math.max(1, Math.min(500, Number(req.body?.count || 20)));
    const result = await createBotGames({ count });
    res.json({ success: true, result, status: await getBotStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/regenerate', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(5000, Number(req.body?.limit || 500)));
    const result = await regenerateBotGameHtml({ limit });
    res.json({ success: true, result, status: await getBotStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/dream', async (req, res) => {
  try {
    const count = Math.max(1, Math.min(50, Number(req.body?.count || 1)));
    const concurrency = Math.max(1, Math.min(3, Number(req.body?.concurrency || 1)));
    const result = await dreamBotGames({ count, concurrency });
    res.json({ success: true, result, status: await getBotStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/tick', async (req, res) => {
  try {
    const actions = Math.max(1, Math.min(5000, Number(req.body?.actions || 100)));
    const createGames = Boolean(req.body?.createGames);
    const result = await runBotActivityTick({ actions, createGames });
    res.json({ success: true, result, status: await getBotStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
