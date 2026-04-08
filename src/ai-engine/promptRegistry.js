/**
 * DreamStream Prompt Registry v3.0
 *
 * Live architecture:
 * Phase 1: QUANTIZE  — Llama 3.3 70B Instruct on NIM extracts structured spec
 * Phase 1.5: SCAFFOLD — Llama 3.3 creates a shared shell + collaboration contract
 * Phase 2A: ART      — Qwen 3.5 on NIM writes RenderEngine drawing code
 * Phase 2B: ENGINE   — Qwen 3 Coder on NIM writes the full gameplay HTML shell
 * Phase 3: VERIFY    — Puppeteer sandbox validates the game doesn't crash
 */

import fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────────────────
// VISUAL STYLE REFERENCE
// ─────────────────────────────────────────────────────────

const VISUAL_STYLES = [
  'NEON_CYBERPUNK', 'PIXEL_RETRO', 'FLAT_VECTOR', 'DARK_HORROR',
  'PASTEL_CUTE', 'NATURE_ORGANIC', 'SPACE_COSMIC', 'OCEAN_AQUATIC',
  'DESERT_WARM', 'WINTER_COLD'
];

const ATMOSPHERES = [
  'Bright & Cheerful', 'Dark & Menacing', 'Neon & Electric',
  'Calm & Relaxing', 'Tense & Stressful', 'Mysterious & Eerie'
];

const PACING = ['Fast / Arcade', 'Medium / Balanced', 'Slow / Strategic', 'Turn-Based'];

function formatPromptList(items, fallback = 'none provided') {
  if (!Array.isArray(items) || items.length === 0) return fallback;
  return items.map((item) => `- ${item}`).join('\n');
}

function normalizeList(items, fallback = []) {
  return Array.isArray(items) && items.length > 0 ? items : fallback;
}

// ─────────────────────────────────────────────────────────
// PHASE 1: QUANTIZE REQUIREMENTS (runs on Llama 3.3 70B Instruct)
// AI acts as Lead Game Designer — extracts structured spec
// ─────────────────────────────────────────────────────────

export function buildPhase1_Quantize(userPrompt) {
  return {
    system: `You are a Lead Game Designer for a mobile HTML5 Canvas2D game studio.
Your job is to analyze a user's casual game idea and extract a precise, structured Game Spec Sheet.

IMPORTANT RULES:
- Output ONLY raw JSON, no markdown, no explanation.
- Be creative but realistic for a mobile casual game.
- The visual style MUST match the mood of the game (horror = dark, cute = pastel, etc.)
- Choose a background color that FITS the game theme. DO NOT default to dark/black unless the game is actually dark-themed.
- Games should be touch-friendly (tap, swipe, drag — no keyboard required).
- The spec must describe a game the engineer can ship as one self-contained mobile HTML canvas experience.
- If the user's ask is too large, scale it into a strong playable vertical slice instead of describing an impossible full production game.
- renderManifest MUST be specific to the requested game. Never use a fixed default list from some unrelated genre.

Available Visual Styles: ${VISUAL_STYLES.join(', ')}
Available Atmospheres: ${ATMOSPHERES.join(', ')}
Available Pacing: ${PACING.join(', ')}`,

    user: `USER PROMPT: "${userPrompt}"

Extract a Game Spec Sheet as JSON:
{
  "title": "Creative game title",
  "genre": "Best fitting genre",
  "summary": "2-3 sentence game description with clear mechanics",
  "coreMechanics": ["mechanic1", "mechanic2", "mechanic3"],
  "visualStyle": "ONE from the Visual Styles list",
  "atmosphere": "ONE from the Atmospheres list",
  "pacing": "ONE from the Pacing list",
  "levelDesign": "Endless | Single Screen Arena | Linear Levels",
  "backgroundColor": "#hex color that matches the theme and visual style",
  "accentColor": "#hex secondary color for UI elements",
  "entities": {
    "hero": "What the player controls (be specific and visual — e.g. 'a small glowing boy')",
    "enemy": "What threatens the player (be specific — e.g. 'a tall dark priest with red eyes')",
    "collectible": "What the player collects (e.g. 'glowing TV screens', or null)",
    "obstacle": "Environmental hazards (e.g. 'dark fog patches', or null)"
  },
  "renderManifest": ["drawHero", "drawEnemy", "drawObstacle", "drawProjectile", "drawPickup", "drawParticle"],
  "heroEmoji": "Single emoji representing the hero (e.g. 👦, 🚀, 🐱)",
  "enemyEmoji": "Single emoji representing the enemy (e.g. 👹, 👾, 🧟)",
  "collectibleEmoji": "Single emoji for collectible (e.g. 📺, 💎, ⭐) or null",
  "scoreLabel": "What to call the score (e.g. TVS COLLECTED, COINS, KILLS)",
  "healthLabel": "What to call health/lives (e.g. SANITY, LIVES, HEALTH)",
  "gameOverTitle": "Thematic game over message",
  "difficulty": "easy | medium | hard",
  "seed": "A random alphanumeric string (e.g. 'f9a2b7')"
}

renderManifest rules:
- Always include drawBackground and drawHUD implicitly through the shared API; do NOT list them in renderManifest.
- Include 3 to 8 function names only.
- Function names must match the actual fantasy of the prompt.
- Good example for an auto-battler: ["drawKnight", "drawArcher", "drawWizard", "drawGoblin", "drawExplosion", "drawDamageNumber"]
- Good example for a racing game: ["drawPlayerCar", "drawTrafficCar", "drawBarrier", "drawBoostPickup", "drawSmokeParticle"]
- Bad example: reusing knight/goblin names for every game no matter the prompt.

Output ONLY the JSON.`
  };
}

export function buildLabsSoloPrototype(userPrompt) {
  return `You are an elite solo HTML5 game engineer-artist.
Build a COMPLETE mobile-first HTML5 Canvas game as a single self-contained HTML file.
You are working alone: you must handle gameplay logic, rendering, HUD, interactions, and game feel yourself.

USER PROMPT:
"${userPrompt}"

CORE RULES:
- Output ONLY raw HTML starting with <!DOCTYPE html>.
- Use native Canvas2D only. No external libraries or remote assets.
- Touch-first controls only (pointerdown / pointermove / pointerup). No keyboard dependency.
- Boot immediately at top level. Do NOT wait for DOMContentLoaded or window.onload.
- Draw a visible first frame synchronously so the screen is never blank.
- If the prompt asks for something huge, compress it into one excellent playable vertical slice.
- Favor a strong, working game loop over sprawling ambition.
- If this is an auto-battler or battle game, the result must be actually playable:
  - visible prep/setup or immediate combat
  - obvious interaction
  - real state changes
  - enemies spawn and can be defeated
  - a win/loss or reset path exists
- Include score/HUD, moment-to-moment feedback, and at least a little juice.
- Render your own stylized art with Canvas2D; do not rely on emojis or external image URLs.
- Keep it phone-readable and avoid tiny UI.

BOOT + RELIABILITY:
- Wrap initialization in try/catch and render a visible in-game error panel if something fails.
- The opening frame must already show the theme, background, and at least one important interactive or playable element.
- Never leave placeholder comments for core gameplay.

PERFORMANCE:
- Keep it efficient enough for a mobile WebView.
- Fake scale with waves, particles, layered enemies, and damage numbers instead of simulating absurdly huge systems.

OUTPUT:
- Return ONLY the complete HTML document.
- No markdown fences.
- No explanation.`;
}

export function buildPhase1B_Scaffold(specSheet) {
  return {
    system: `You are the Technical Design Lead for a mobile HTML5 Canvas game studio.
Your job is to turn a validated game spec into a SHARED SCAFFOLD CONTRACT that both the artist and engineer can follow.

IMPORTANT RULES:
- Output ONLY raw JSON.
- Think like a gameplay lead creating a playable shell, not a prose writer.
- Keep the scaffold realistic for one self-contained mobile canvas game.
- Prefer one polished vertical slice over impossible scope.
- Include only contracts and structure the team can actually execute in one pass.`,
    user: `GAME SPEC:
${JSON.stringify(specSheet, null, 2)}

Return this JSON shape:
{
  "initialState": "MENU | PREP | PLAYING",
  "stateFlow": ["MENU", "PREP", "BATTLE", "RESULT"],
  "cameraMode": "single_screen | follow_player | anchored_arena",
  "worldRules": ["short practical world rule"],
  "hudBlocks": ["currency", "health", "battle_button"],
  "entityBlueprints": [
    {
      "id": "knight",
      "role": "ally | enemy | projectile | pickup | fx | obstacle",
      "renderFn": "drawKnight",
      "width": 72,
      "height": 72,
      "spawnRule": "how it appears in the scene"
    }
  ],
  "firstFrameChecklist": ["visible thing that must exist on first frame"],
  "interactionLoops": ["short input or game-loop description"],
  "engineTodos": ["concrete engineering task"],
  "artistTodos": ["concrete art/render task"],
  "integrationNotes": ["how art + logic should fit together"]
}

Rules:
- entityBlueprints must align with renderManifest and the requested game fantasy.
- Include 3 to 8 entityBlueprints.
- Width and height must be realistic gameplay sizes, never 1.
- stateFlow should reflect the actual lane. Auto-battlers should usually use MENU/PREP/BATTLE/RESULT.
- firstFrameChecklist must guarantee a non-black, readable first frame.
- integrationNotes should describe how the engineer should call the render API safely.

Output ONLY JSON.`
  };
}

export function buildSharedScaffoldShell(specSheet, scaffold) {
  const stateFlow = normalizeList(scaffold?.stateFlow, ['MENU', 'PLAYING', 'RESULT']);
  const entityBlueprints = normalizeList(scaffold?.entityBlueprints, []).slice(0, 8);
  const firstEntity = entityBlueprints[0] || { id: 'hero', renderFn: 'drawHero', width: 72, height: 72, role: 'ally' };
  const secondEntity = entityBlueprints[1] || { id: 'enemy', renderFn: 'drawEnemy', width: 64, height: 64, role: 'enemy' };
  const hudBlocks = normalizeList(scaffold?.hudBlocks, ['score', 'health']);
  const worldRules = normalizeList(scaffold?.worldRules, ['Keep the experience readable on a phone screen.']);
  const engineTodos = normalizeList(scaffold?.engineTodos, ['Implement a complete update loop and state transitions.']);
  const interactionLoops = normalizeList(scaffold?.interactionLoops, ['Use touch-first controls and keep the first interaction obvious.']);
  const integrationNotes = normalizeList(scaffold?.integrationNotes, ['Always render through window.RenderEngine functions.']);
  const safeScaffoldJson = JSON.stringify({
    initialState: scaffold?.initialState || 'MENU',
    stateFlow,
    cameraMode: scaffold?.cameraMode || 'single_screen',
    hudBlocks,
    worldRules,
    entityBlueprints,
    firstFrameChecklist: normalizeList(scaffold?.firstFrameChecklist, ['Draw a visible background and at least one ally + one enemy.']),
    interactionLoops,
    engineTodos,
    artistTodos: normalizeList(scaffold?.artistTodos, ['Create readable silhouettes and themed background depth.']),
    integrationNotes,
  }, null, 2);
  const allyBlueprints = entityBlueprints.filter((entity) => entity.role === 'ally');
  const enemyBlueprints = entityBlueprints.filter((entity) => entity.role === 'enemy');
  const safeAllies = allyBlueprints.length > 0 ? allyBlueprints : [firstEntity];
  const safeEnemies = enemyBlueprints.length > 0 ? enemyBlueprints : [secondEntity];

  if (specSheet.runtimeLane === 'auto_battler_arena') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>${specSheet.title}</title>
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: ${specSheet.backgroundColor || '#111111'};
      touch-action: none;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    }
    canvas {
      display: block;
      width: 100vw;
      height: 100vh;
      touch-action: none;
    }
  </style>
</head>
<body>
  <canvas id="game"></canvas>
  <script>
  const DreamScaffold = ${safeScaffoldJson};
  const UnitCatalog = ${JSON.stringify(safeAllies, null, 2)};
  const EnemyCatalog = ${JSON.stringify(safeEnemies, null, 2)};
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const TOP_INSET = 112;
  const SIDE_PAD = 24;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function distance(a, b) {
    return Math.hypot((a.x + a.width / 2) - (b.x + b.width / 2), (a.y + a.height / 2) - (b.y + b.height / 2));
  }

  function pointInRect(x, y, rect) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  function makeDamageNumber(x, y, value, color) {
    return { x, y, value, color, life: 0.9 };
  }

  function createUnitFromBlueprint(blueprint, x, y, side) {
    const archetype = String(blueprint.id || '').toLowerCase();
    const isKnight = archetype.includes('knight');
    const isArcher = archetype.includes('archer');
    const isWizard = archetype.includes('wizard');
    const isGoblin = archetype.includes('goblin');
    return {
      id: Math.random().toString(36).slice(2),
      type: blueprint.id,
      renderFn: blueprint.renderFn,
      x,
      y,
      width: blueprint.width || 64,
      height: blueprint.height || 64,
      side,
      hp: isKnight ? 180 : isWizard ? 90 : isArcher ? 110 : isGoblin ? 55 : 100,
      maxHp: isKnight ? 180 : isWizard ? 90 : isArcher ? 110 : isGoblin ? 55 : 100,
      damage: isKnight ? 26 : isWizard ? 18 : isArcher ? 12 : isGoblin ? 10 : 12,
      speed: isKnight ? 62 : isWizard ? 48 : isArcher ? 72 : isGoblin ? 78 : 70,
      range: isKnight ? 78 : isWizard ? 180 : isArcher ? 220 : isGoblin ? 54 : 70,
      cooldown: 0.2,
      attackRate: isKnight ? 0.8 : isWizard ? 1.3 : isArcher ? 0.55 : isGoblin ? 0.75 : 0.8,
      archetype,
      knockback: isKnight ? 18 : isWizard ? 8 : 5,
      aoe: isWizard ? 82 : 0
    };
  }

  const game = {
    state: DreamScaffold.initialState || 'PREP',
    camera: { x: 0, y: 0, shake: 0 },
    score: 0,
    health: 100,
    wave: 1,
    battleTimer: 0,
    previewIndex: 0,
    placementSlots: [],
    allies: [],
    enemies: [],
    projectiles: [],
    particles: [],
    damageNumbers: [],
    pointer: { x: 0, y: 0, down: false },
    lastTime: 0,
    ui: {
      battleButton: { x: 0, y: 0, w: 188, h: 66, label: 'BATTLE', visible: true }
    },
    resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      this.ui.battleButton.x = canvas.width - this.ui.battleButton.w - SIDE_PAD;
      this.ui.battleButton.y = TOP_INSET + 6;
      const laneTop = TOP_INSET + 124;
      const laneHeight = canvas.height - laneTop - 84;
      const laneBottom = laneTop + laneHeight;
      this.placementSlots = Array.from({ length: 4 }, (_, index) => ({
        x: 92 + index * 88,
        y: laneBottom - 136 - (index % 2) * 58,
        w: 76,
        h: 76
      }));
    },
    resetPrep() {
      this.state = 'PREP';
      this.wave = 1;
      this.battleTimer = 0;
      this.enemies = [];
      this.projectiles = [];
      this.particles = [];
      this.damageNumbers = [];
      this.health = 100;
      this.score = 0;
      this.previewIndex = 0;
      this.ui.battleButton.visible = true;
      this.allies = this.placementSlots.slice(0, 3).map((slot, index) => {
        const blueprint = UnitCatalog[index % UnitCatalog.length];
        return createUnitFromBlueprint(blueprint, slot.x, slot.y, 'ally');
      });
    },
    spawnGoblinWave(count) {
      const enemyBlueprint = EnemyCatalog[0];
      for (let i = 0; i < count; i++) {
        const yBase = TOP_INSET + 170 + (i % 4) * 88;
        this.enemies.push(createUnitFromBlueprint(enemyBlueprint, canvas.width - 170 + (i % 2) * 18, yBase + Math.floor(i / 2) * 22, 'enemy'));
      }
    },
    startBattle() {
      if (this.allies.length === 0) return;
      this.state = 'BATTLE';
      this.ui.battleButton.visible = false;
      this.spawnGoblinWave(5);
    },
    cycleSlot(slotIndex) {
      const slot = this.placementSlots[slotIndex];
      const blueprint = UnitCatalog[this.previewIndex % UnitCatalog.length];
      this.previewIndex += 1;
      const existing = this.allies.findIndex((unit) => unit.slotIndex === slotIndex);
      const unit = createUnitFromBlueprint(blueprint, slot.x, slot.y, 'ally');
      unit.slotIndex = slotIndex;
      if (existing >= 0) this.allies.splice(existing, 1, unit);
      else this.allies.push(unit);
    },
    applyDamage(target, amount, source) {
      if (!target) return;
      target.hp -= amount;
      this.damageNumbers.push(makeDamageNumber(target.x + target.width / 2, target.y, amount, source && source.side === 'ally' ? '#fef08a' : '#fca5a5'));
      this.camera.shake = Math.max(this.camera.shake, source && source.archetype.includes('knight') ? 10 : 5);
    },
    updateUnit(unit, opponents, dt) {
      if (!unit || opponents.length === 0) return;
      unit.cooldown -= dt;
      const target = opponents.reduce((best, candidate) => !best || distance(unit, candidate) < distance(unit, best) ? candidate : best, null);
      if (!target) return;
      const gap = distance(unit, target);
      if (gap > unit.range) {
        const dirX = ((target.x - unit.x) || 1) / gap;
        const dirY = ((target.y - unit.y) || 1) / gap;
        unit.x += dirX * unit.speed * dt * (unit.side === 'ally' ? 1 : -1);
        unit.y += dirY * unit.speed * dt * 0.4;
      } else if (unit.cooldown <= 0) {
        unit.cooldown = unit.attackRate;
        if (unit.aoe > 0) {
          opponents.forEach((candidate) => {
            if (distance(candidate, target) <= unit.aoe) this.applyDamage(candidate, unit.damage, unit);
          });
        } else if (unit.range > 120) {
          this.projectiles.push({
            x: unit.x + unit.width / 2,
            y: unit.y + unit.height / 2,
            tx: target.x + target.width / 2,
            ty: target.y + target.height / 2,
            damage: unit.damage,
            owner: unit.side,
            speed: unit.archetype.includes('archer') ? 520 : 360
          });
        } else {
          this.applyDamage(target, unit.damage, unit);
          target.x += unit.side === 'ally' ? unit.knockback : -unit.knockback;
        }
      }
    },
    updateProjectiles(dt) {
      this.projectiles = this.projectiles.filter((projectile) => {
        const dx = projectile.tx - projectile.x;
        const dy = projectile.ty - projectile.y;
        const dist = Math.hypot(dx, dy) || 1;
        projectile.x += (dx / dist) * projectile.speed * dt;
        projectile.y += (dy / dist) * projectile.speed * dt;
        const targets = projectile.owner === 'ally' ? this.enemies : this.allies;
        const hit = targets.find((target) => Math.hypot(projectile.x - (target.x + target.width / 2), projectile.y - (target.y + target.height / 2)) < target.width * 0.45);
        if (hit) {
          this.applyDamage(hit, projectile.damage, { side: projectile.owner, archetype: projectile.owner });
          return false;
        }
        return dist > 18;
      });
    },
    cleanupDead() {
      const removedEnemies = this.enemies.filter((unit) => unit.hp <= 0).length;
      if (removedEnemies > 0) this.score += removedEnemies * 10;
      this.allies = this.allies.filter((unit) => unit.hp > 0);
      this.enemies = this.enemies.filter((unit) => unit.hp > 0);
    },
    update(dt, time) {
      this.damageNumbers.forEach((item) => { item.y -= 42 * dt; item.life -= dt; });
      this.damageNumbers = this.damageNumbers.filter((item) => item.life > 0);
      this.camera.shake = Math.max(0, this.camera.shake - dt * 18);
      if (this.state !== 'BATTLE') return;
      this.battleTimer += dt;
      if (this.enemies.length < 3 && this.wave < 4) {
        this.wave += 1;
        this.spawnGoblinWave(3 + this.wave);
      }
      this.allies.forEach((unit) => this.updateUnit(unit, this.enemies, dt));
      this.enemies.forEach((unit) => this.updateUnit(unit, this.allies, dt));
      this.updateProjectiles(dt);
      this.cleanupDead();
      if (this.allies.length === 0) {
        this.state = 'RESULT';
        this.ui.battleButton.label = 'TRY AGAIN';
        this.ui.battleButton.visible = true;
      } else if (this.wave >= 4 && this.enemies.length === 0) {
        this.state = 'RESULT';
        this.ui.battleButton.label = 'REMATCH';
        this.ui.battleButton.visible = true;
      }
    },
    renderFallbackEntity(entity) {
      ctx.save();
      ctx.translate(entity.x - this.camera.x, entity.y - this.camera.y);
      ctx.fillStyle = entity.side === 'ally' ? '#f59e0b' : '#22c55e';
      if (entity.archetype && entity.archetype.includes('wizard')) ctx.fillStyle = '#a855f7';
      if (entity.archetype && entity.archetype.includes('archer')) ctx.fillStyle = '#38bdf8';
      ctx.fillRect(0, 0, entity.width, entity.height);
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, entity.width, entity.height);
      ctx.restore();
    },
    renderEntity(entity, time) {
      if (!entity || !entity.renderFn || !window.RenderEngine) return;
      const fn = window.RenderEngine[entity.renderFn];
      if (typeof fn === 'function' && !fn.__dreamstreamStub) {
        fn(ctx, entity.x - this.camera.x, entity.y - this.camera.y, entity.width, entity.height, time);
      } else {
        this.renderFallbackEntity(entity);
      }
    },
    drawArena() {
      const arenaTop = TOP_INSET + 118;
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(SIDE_PAD, arenaTop, canvas.width - SIDE_PAD * 2, canvas.height - arenaTop - 36);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const x = SIDE_PAD + 30 + i * ((canvas.width - SIDE_PAD * 2 - 60) / 5);
        ctx.beginPath();
        ctx.moveTo(x, arenaTop);
        ctx.lineTo(x, canvas.height - 40);
        ctx.stroke();
      }
      ctx.restore();
    },
    drawPrepSlots() {
      if (this.state !== 'PREP') return;
      ctx.save();
      this.placementSlots.forEach((slot, index) => {
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 3;
        ctx.strokeRect(slot.x, slot.y, slot.w, slot.h);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
        ctx.fillStyle = '#f8fafc';
        ctx.font = '12px system-ui';
        ctx.fillText(String(index + 1), slot.x + 8, slot.y + 18);
      });
      ctx.restore();
    },
    drawBattleButton() {
      if (!this.ui.battleButton.visible) return;
      const b = this.ui.battleButton;
      ctx.save();
      ctx.fillStyle = '${specSheet.accentColor || '#ffd54a'}';
      ctx.strokeStyle = '#141414';
      ctx.lineWidth = 4;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = '#141414';
      ctx.font = 'bold 28px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
      ctx.restore();
    },
    drawDamageNumbers() {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 20px system-ui';
      this.damageNumbers.forEach((item) => {
        ctx.globalAlpha = clamp(item.life, 0, 1);
        ctx.fillStyle = item.color;
        ctx.fillText(String(item.value), item.x, item.y);
      });
      ctx.restore();
    },
    render(time) {
      const shakeX = (Math.random() - 0.5) * this.camera.shake;
      const shakeY = (Math.random() - 0.5) * this.camera.shake;
      ctx.save();
      ctx.translate(shakeX, shakeY);
      window.RenderEngine.drawBackground(ctx, canvas.width, canvas.height, this.camera.x || 0, this.camera.y || 0, time);
      this.drawArena();
      this.drawPrepSlots();
      this.allies.forEach((entity) => this.renderEntity(entity, time));
      this.enemies.forEach((entity) => this.renderEntity(entity, time));
      this.drawDamageNumbers();
      this.drawBattleButton();
      window.RenderEngine.drawHUD(ctx, canvas.width, canvas.height, this.score, this.health);
      ctx.restore();
    },
    handlePointerDown(x, y) {
      if (this.ui.battleButton.visible && pointInRect(x, y, this.ui.battleButton)) {
        if (this.state === 'PREP') this.startBattle();
        else this.resetPrep();
        return;
      }
      if (this.state !== 'PREP') return;
      const slotIndex = this.placementSlots.findIndex((slot) => pointInRect(x, y, slot));
      if (slotIndex >= 0) this.cycleSlot(slotIndex);
    },
    loop(now) {
      const dt = Math.min(0.033, (now - this.lastTime) / 1000 || 0.016);
      this.lastTime = now;
      this.update(dt, now / 1000);
      this.render(now / 1000);
      requestAnimationFrame(this.loop.bind(this));
    }
  };

  function renderFatal(error) {
    document.body.innerHTML = '<div style="padding:16px;color:#fff;background:#7f1d1d;font-family:system-ui;">Boot error: ' + String(error && error.message || error) + '</div>';
  }

  try {
    game.resize();
    game.resetPrep();
    window.addEventListener('resize', () => game.resize());
    window.addEventListener('pointerdown', (event) => {
      game.pointer.down = true;
      game.pointer.x = event.clientX;
      game.pointer.y = event.clientY;
      game.handlePointerDown(event.clientX, event.clientY);
    });
    window.addEventListener('pointerup', () => { game.pointer.down = false; });
    game.render(0);
    requestAnimationFrame(game.loop.bind(game));
  } catch (error) {
    renderFatal(error);
  }
  </script>
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>${specSheet.title}</title>
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: ${specSheet.backgroundColor || '#111111'};
      touch-action: none;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    }
    canvas {
      display: block;
      width: 100vw;
      height: 100vh;
      touch-action: none;
    }
  </style>
</head>
<body>
  <canvas id="game"></canvas>
  <script>
  const DreamScaffold = ${safeScaffoldJson};
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const game = {
    state: DreamScaffold.initialState,
    stateFlow: DreamScaffold.stateFlow,
    camera: { x: 0, y: 0, shakeX: 0, shakeY: 0 },
    score: 0,
    health: 100,
    wave: 1,
    allies: [],
    enemies: [],
    projectiles: [],
    pickups: [],
    particles: [],
    damageNumbers: [],
    ui: {
      battleButton: { x: 0, y: 0, w: 184, h: 64, label: 'BATTLE', visible: true }
    },
    bootReady: false,
    pointer: { x: 0, y: 0, down: false },
    lastTime: 0,
    seedFirstFrame() {
      this.allies = [{
        type: '${firstEntity.id}',
        renderFn: '${firstEntity.renderFn}',
        x: 240,
        y: 500,
        width: ${firstEntity.width},
        height: ${firstEntity.height},
        hp: 100
      }];
      this.enemies = [{
        type: '${secondEntity.id}',
        renderFn: '${secondEntity.renderFn}',
        x: 820,
        y: 360,
        width: ${secondEntity.width},
        height: ${secondEntity.height},
        hp: 100
      }];
    },
    resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      this.ui.battleButton.x = canvas.width - this.ui.battleButton.w - 24;
      this.ui.battleButton.y = 24;
    },
    renderEntity(entity, time) {
      if (!entity || !entity.renderFn || !window.RenderEngine) return;
      const fn = window.RenderEngine[entity.renderFn];
      if (typeof fn === 'function') {
        fn(ctx, entity.x - this.camera.x, entity.y - this.camera.y, entity.width, entity.height, time);
      }
    },
    drawBattleButton() {
      if (!this.ui.battleButton.visible) return;
      const b = this.ui.battleButton;
      ctx.save();
      ctx.fillStyle = '${specSheet.accentColor || '#ffd54a'}';
      ctx.strokeStyle = '#141414';
      ctx.lineWidth = 4;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = '#141414';
      ctx.font = 'bold 28px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
      ctx.restore();
    },
    render(time) {
      window.RenderEngine.drawBackground(ctx, canvas.width, canvas.height, this.camera.x || 0, this.camera.y || 0, time);
      for (const entity of this.allies) this.renderEntity(entity, time);
      for (const entity of this.enemies) this.renderEntity(entity, time);
      this.drawBattleButton();
      window.RenderEngine.drawHUD(ctx, canvas.width, canvas.height, this.score, this.health);
    },
    loop(now) {
      const time = now / 1000;
      const dt = Math.min(0.033, (now - this.lastTime) / 1000 || 0.016);
      this.lastTime = now;
      this.update(dt, time);
      this.render(time);
      requestAnimationFrame(this.loop.bind(this));
    },
    update(dt, time) {
      // TODO_ENGINE: Implement full state machine, input handling, combat, spawning, physics, and win/loss flow.
      // DreamScaffold.engineTodos:
      // ${engineTodos.join('\n      // ')}
      // DreamScaffold.interactionLoops:
      // ${interactionLoops.join('\n      // ')}
      // DreamScaffold.worldRules:
      // ${worldRules.join('\n      // ')}
    }
  };

  function renderFatal(error) {
    document.body.innerHTML = '<div style="padding:16px;color:#fff;background:#7f1d1d;font-family:system-ui;">Boot error: ' + String(error && error.message || error) + '</div>';
  }

  try {
    game.resize();
    game.seedFirstFrame();
    window.addEventListener('resize', () => game.resize());
    window.addEventListener('pointerdown', (event) => {
      game.pointer.down = true;
      game.pointer.x = event.clientX;
      game.pointer.y = event.clientY;
    });
    window.addEventListener('pointerup', () => { game.pointer.down = false; });
    game.render(0);
    requestAnimationFrame(game.loop.bind(game));
  } catch (error) {
    renderFatal(error);
  }
  </script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────
// LEGACY: Single-agent prototype prompt kept for local prompt experiments.
// The production DreamStream route uses the Artist + Engineer split below.
// ─────────────────────────────────────────────────────────

export function buildPhase2_BuildPrototype(specSheet) {
  return `You are an expert Creative Coder and Game Engine Specialist. Build a COMPLETE, POLISHED, PRODUCTION-QUALITY mobile game as a single HTML file.

GAME SPECIFICATION:
- Title: ${specSheet.title}
- Genre: ${specSheet.genre}
- Summary: ${specSheet.summary}
- Core Mechanics: ${JSON.stringify(specSheet.coreMechanics)}
- Visual Style: ${specSheet.visualStyle}
- Atmosphere: ${specSheet.atmosphere}
- Pacing: ${specSheet.pacing}
- Background Color: ${specSheet.backgroundColor}
- Accent Color: ${specSheet.accentColor}

ENTITIES (draw these as colored geometric shapes — NO emojis, NO images):
- Hero: ${specSheet.entities?.hero}
- Enemy: ${specSheet.entities?.enemy}
- Collectible: ${specSheet.entities?.collectible || 'none'}

UI LABELS:
- Score: "${specSheet.scoreLabel || 'SCORE'}"
- Health: "${specSheet.healthLabel || 'LIVES'}"
- Game Over: "${specSheet.gameOverTitle || 'GAME OVER'}"

DETERMINISTIC SEED: "${specSheet.seed || 'f9a2b7'}"
You MUST implement a seeded random number generator (PRNG) and use it for ALL procedural generation and gameplay randomness.

═══════════════════════════════════════════
CRITICAL IMPLEMENTATION RULES:
═══════════════════════════════════════════
You MUST choose one of the following engines based on the game genre and visuals:
1. THREE.JS (via CDN: https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js)
   - Best for: 3D games, immersive environments, first-person or third-person perspectives.
2. P5.JS (via CDN: https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.js)
   - Best for: Creative art games, complex 2D physics, generative visuals.
3. CANVAS 2D (Native)
   - Best for: Classic 2D arcade games, platformers, top-down shooters.
4. DOM/CSS (Native)
   - Best for: Card games, puzzles, trivia, word games.

═══════════════════════════════════════════
CRITICAL IMPLEMENTATION RULES:
═══════════════════════════════════════════

1. SINGLE FILE: Everything in ONE HTML document. You MAY use CDNs for Three.js or p5.js if chosen.
   - You MUST include <meta charset="UTF-8"> in the <head>.

2. MOBILE-FIRST TOUCH CONTROLS (STRICT):
   - USE 'pointerdown', 'pointermove', 'pointerup' for universal touch/mouse support.
   - Add 'touch-action: none;' to your CSS for the body/canvas so iOS doesn't intercept the touches.
   - Attach your event listeners directly to the window or canvas (e.g. window.addEventListener('pointerdown', ...)).
   - Do NOT use the 'click' event. It is swallowed by iOS WebViews.

3. FULLSCREEN RESPONSIVE:
   - Must fill the entire viewport (100vw, 100vh).
   - Handle window resize events to update camera/canvas.
   - CSS: body { margin: 0; overflow: hidden; background: ${specSheet.backgroundColor}; touch-action: none; }
   - ⚠️ MUST USE VIBRANT BACKGROUNDS: At the start of your draw loop, NEVER clear the screen with \`ctx.fillStyle = "black";\`. You MUST clear using \`ctx.clearRect(0, 0, canvas.width, canvas.height);\` so the vibrant CSS background color shows through!

4. WORLD CAMERA & EXPANSIVE MOVEMENT (CRITICAL):
   - DO NOT trap the player in a single small screen box unless it's a puzzle game!
   - For RPGs, Survival, Shooters, and Platformers, the world MUST be massive or strictly infinite. 
   - You MUST implement a Camera System. In Canvas2D, calculate \`camera.x\` and \`camera.y\` to follow the player, and use \`ctx.save(); ctx.translate(-camera.x, -camera.y);\` before drawing the game world (and restore before drawing HUD).
   - Spawn enemies and environment objects dynamically across global world coordinates, not just the visible screen!

5. ENTITY RENDERING (ARTIST-CODER PROCEDURAL GRAPHICS):
   - ⚠️ ABSOLUTELY NO EXTERNAL IMAGES OR URLS. Do NOT attempt to load external sprites, PNGs, or textures!
   - ⚠️ NEVER USE EMOJIS OR UNICODE CHARACTERS. The device CANNOT render them — they show as broken boxes.
   - You MUST act as an 'Artist-Coder'. You will draw every single entity (Player, Enemies, Backgrounds, Collectibles) procedurally using pure Canvas2D API.
   - The hero description is: ${specSheet.entities?.hero || "Main player character"}
   - The enemy description is: ${specSheet.entities?.enemy || "Adversary or obstacle"}
   - 🔥 DO NOT DRAW BORING RECTANGLES OR BASIC CIRCLES! 
   - Write custom generative, multi-layered Canvas drawing sequence functions for each entity. Use bezier curves, gradients, globalCompositeOperation, shadows, glowing effects, and paths.
   - Make it look Spectacular and match the game's theme perfectly.
   - Example abstract energetic procedural art:
     \`\`\`javascript
     function drawHero(ctx, x, y, width, height) {
         ctx.save();
         ctx.translate(x + width/2, y + height/2);
         const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, width);
         gradient.addColorStop(0, '#fff');
         gradient.addColorStop(1, '${specSheet.accentColor || '#f0f'}');
         ctx.fillStyle = gradient;
         ctx.shadowBlur = 15;
         ctx.shadowColor = '${specSheet.accentColor || '#f0f'}';
         ctx.beginPath();
         // ... (Write complex procedural paths here mapping your character's shape)
         ctx.arc(0, 0, width/2, 0, Math.PI * 2);
         ctx.fill();
         ctx.restore();
     }
     \`\`\`
   - Each entity type MUST be at least 30x30 pixels and visually distinct.

6. HUD & UI:
   - Score: "${specSheet.scoreLabel || 'SCORE'}"
   - Health: "${specSheet.healthLabel || 'LIVES'}"
   - Use accent color (${specSheet.accentColor}).
   - High-contrast for readability on small screens.

7. GAME STATES & BOOTING (CRITICAL FOR IOS):
   - ⚠️ DO NOT wrap your initialization code in \`window.onload\` or \`document.addEventListener('DOMContentLoaded')\`. It will fail in iOS WebViews! Execute your setup IMMEDIATELY at the top level.
   - MENU: Draw centered title and "TAP TO START" text directly on the Canvas.
   - You MUST transition from MENU to PLAYING state exactly like this:
     window.addEventListener('pointerdown', () => { if (gameState === 'MENU') gameState = 'PLAYING'; });
   - Do NOT create physical HTML <button> overlays. They block touches in iOS WebViews. Draw everything on the canvas and listen for a global screen tap!
   - PLAYING: Core gameplay.
   - GAMEOVER: Draw "${specSheet.gameOverTitle || 'GAME OVER'}", final score, "TAP TO RESTART".

7. GAME FEEL / JUICE (MANDATORY):
   - Immersive screen shake / camera shake on impact.
   - Visual feedback for Every Action (flashes, tiny particles, scaling).
   - Sound: Use Web Audio API for synthesized effects (Collect: chirpy, Hit: deep thud).

8. ERROR HANDLING & LOGGING (CRITICAL FOR MOBILE):
   - Use try/catch blocks. Render error text on the screen if the engine fails to initialize.
   - DO NOT use console.log(), console.warn(), or console.error() inside the game loop (requestAnimationFrame). Spamming the console will CRASH the mobile wrapper.
   - Never log massive objects like 'window' or DOM events.

OUTPUT FORMAT:
Return ONLY the complete HTML code. Do NOT wrap in markdown. No explanation. Just raw HTML starting with <!DOCTYPE html>.`;
}

// ─────────────────────────────────────────────────────────
// EDIT PROMPT HELPER (kept for local experiments and legacy tooling)
// ─────────────────────────────────────────────────────────

export function buildPhase2_EditGame(engineCode, instructions, artistCode) {
  // If we have separate artist code, send both sections clearly labeled
  if (artistCode) {
    return `You are an expert HTML5 game developer. You are modifying an existing game that has TWO parts:

===SECTION 1: ARTIST CODE (Canvas drawing functions)===
${artistCode}

===SECTION 2: ENGINE CODE (Game HTML with physics, input, game loop)===
${engineCode}

USER WANTS: "${instructions}"

YOUR TASK:
- If the user wants to change visuals/characters/art → edit SECTION 1 (Artist Code)
- If the user wants to change gameplay/physics/positioning/controls → edit SECTION 2 (Engine Code)  
- If the user wants both → edit both sections

OUTPUT FORMAT (you MUST follow this exactly):
===ARTIST_CODE===
(output the complete artist code JavaScript here — the window.RenderEngine object)
===ENGINE_CODE===
(output the complete engine HTML here — starting with <!DOCTYPE html> and ending with </html>)

RULES:
1. Output BOTH sections every time, even if you only changed one. Copy the unchanged section exactly.
2. NEVER abbreviate, truncate, or use "..." or "// rest of code". Output EVERY line.
3. Do NOT wrap in markdown code blocks. Do NOT add explanation text.
4. The ENGINE_CODE section must start with <!DOCTYPE html> and end with </html>.`;
  }

  // Fallback for legacy games without separate artist code
  return `You are an expert HTML5 game developer. You are modifying an existing game.

EXISTING GAME CODE:
${engineCode}

USER INSTRUCTIONS: "${instructions}"

RULES:
1. Apply ONLY the requested changes to the existing code.
2. CRITICAL: You MUST return the COMPLETE, FULL, UNABRIDGED modified HTML file.
3. NEVER abbreviate, truncate, or skip sections. NEVER write "..." or "// rest of code". Every single line must be present.
4. Keep everything that works — only change what the user asked for.
5. Start with <!DOCTYPE html> and end with </html>.
6. Do NOT wrap in markdown code blocks. Do NOT include explanation.
7. Just output the raw HTML. Nothing else.`;
}


// ─────────────────────────────────────────────────────────
// POST-PROCESSING: Inject runtime diagnostics, Juice, and Audio
// into the raw HTML returned by the gameplay engineer
// ─────────────────────────────────────────────────────────

export function postProcessRawHtml(rawHtml) {
  const runtimeOverlayScript = `
    <script>
      (function() {
        function reportRuntimeIssue(kind, detail) {
          try {
            var existing = document.getElementById('__dreamstream_runtime_error');
            if (!existing) {
              existing = document.createElement('div');
              existing.id = '__dreamstream_runtime_error';
              existing.style.position = 'fixed';
              existing.style.left = '12px';
              existing.style.right = '12px';
              existing.style.top = '12px';
              existing.style.zIndex = '999999';
              existing.style.padding = '14px 16px';
              existing.style.borderRadius = '16px';
              existing.style.background = 'rgba(127, 29, 29, 0.96)';
              existing.style.color = '#fff';
              existing.style.fontFamily = 'system-ui, -apple-system, sans-serif';
              existing.style.fontSize = '13px';
              existing.style.lineHeight = '1.45';
              existing.style.whiteSpace = 'pre-wrap';
              existing.style.boxShadow = '0 12px 32px rgba(0,0,0,0.35)';
              document.body.appendChild(existing);
            }
            existing.textContent = kind + "\\n\\n" + String(detail || 'Unknown runtime failure');
            if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'RUNTIME_ERROR',
                kind: kind,
                detail: String(detail || 'Unknown runtime failure')
              }));
            }
          } catch (e) {}
        }

        window.addEventListener('error', function(event) {
          reportRuntimeIssue('DreamStream runtime error', event && event.message ? event.message : 'Unknown script error');
        });

        window.addEventListener('unhandledrejection', function(event) {
          var reason = event && event.reason ? (event.reason.message || String(event.reason)) : 'Unknown promise rejection';
          reportRuntimeIssue('DreamStream async error', reason);
        });

        window.addEventListener('load', function() {
          setTimeout(function() {
            try {
              var canvas = document.querySelector('canvas');
              if (!canvas) {
                reportRuntimeIssue('DreamStream boot warning', 'No canvas element was rendered after load. The generated game likely failed during initialization.');
              }
            } catch (e) {}
          }, 2500);
        });
      })();
    </script>
  `;

  // Inject Juice Engine
  let juiceScript = '';
  try {
    const juicePath = path.join(process.cwd(), 'src/ai-engine/juice.js');
    const juiceCode = fs.readFileSync(juicePath, 'utf8');
    juiceScript = '<script>' + juiceCode + '</script>';
  } catch (e) {}

  // Inject Audio Engine
  let audioScript = '';
  try {
    const audioPath = path.join(process.cwd(), 'src/ai-engine/audio.js');
    const audioCode = fs.readFileSync(audioPath, 'utf8');
    audioScript = '<script>' + audioCode + '</script>';
  } catch (e) {}

  // Inject right before </body> or at end
  if (rawHtml.includes('</body>')) {
    rawHtml = rawHtml.replace('</body>', runtimeOverlayScript + juiceScript + audioScript + '</body>');
  } else {
    rawHtml += runtimeOverlayScript + juiceScript + audioScript;
  }

  // Force inject essential mobile metas and strict no-selection CSS
  const metaTags = `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <style>
      * {
        -webkit-touch-callout: none !important;
        -webkit-user-select: none !important;
        user-select: none !important;
      }
      body, html {
        touch-action: none;
        overflow: hidden;
      }
    </style>
  `;

  if (rawHtml.includes('<head>')) {
    rawHtml = rawHtml.replace('<head>', '<head>' + metaTags);
  } else if (rawHtml.toLowerCase().includes('<html>')) {
    rawHtml = rawHtml.replace(/<html>/i, '<html><head>' + metaTags + '</head>');
  } else {
    rawHtml = metaTags + rawHtml;
  }

  return rawHtml;
}

// ─────────────────────────────────────────────────────────
// PHASE 2A: ARTIST-CODER (Dedicated Art Generation)
// ─────────────────────────────────────────────────────────
export function buildPhase2A_Artist(specSheet, scaffold) {
  const scaffoldJson = JSON.stringify(scaffold || {}, null, 2);
  return `You are a world-class procedural artist who creates stunning visuals using ONLY Canvas2D JavaScript.
Your job: write a \`window.RenderEngine\` object with drawing functions for a game.
You must NOT write game loops, physics, input handling, or HTML. ONLY drawing code.

GAME CONTEXT:
- Title: "${specSheet.title}"
- Visual Style: ${specSheet.visualStyle}
- Atmosphere: ${specSheet.atmosphere}
- Accent Color: ${specSheet.accentColor || '#f0f'}
- Hero: ${specSheet.entities?.hero || 'Main player character'}
- Enemy: ${specSheet.entities?.enemy || 'Adversary or obstacle'}
- Runtime Lane: ${specSheet.runtimeLane || 'arcade_canvas'}
- Playable Slice: ${specSheet.playableSlice || 'One compact mobile game scene.'}
- Scene Blueprint: ${specSheet.sceneBlueprint || 'A readable stage with one hero and one threat type.'}

SHARED SCAFFOLD CONTRACT:
${scaffoldJson}

VISUAL TARGETS:
${formatPromptList(specSheet.visualTargets, '- clean readable silhouettes')}

SPECTACLE FOCUS:
${formatPromptList(specSheet.spectacleFocus, '- subtle particles and impact flashes')}

MANDATORY CANVAS2D TECHNIQUES:
- Use advanced techniques matching the atmosphere (e.g. ctx.createLinearGradient or ctx.createRadialGradient for rich color fills if needed).
- Use ctx.shadowBlur + ctx.shadowColor ONLY if the game's theme requires glowing/magic/neon/energy. If it's a dark or flat cartoon game, use solid strokes or flat shading instead.
- Use ctx.globalCompositeOperation wisely. Don't use 'lighter' unless making neon/fire/magic effects.
- ctx.save() / ctx.restore() + ctx.translate + ctx.rotate for sub-parts (limbs, wings, turrets).
- Math.sin(time) and Math.cos(time) for idle animations (breathing, bobbing, pulsing).
- Build complex figures from 5+ primitives (do not just use a single shape).

QUALITY RULES:
- Each draw function must use AT LEAST 15 lines of Canvas calls. Simple rectangles or circles alone = FAILURE.
- The hero should look like a recognizable character with body parts, not a blob.
- The enemy must look visually distinct from the hero.
- The background must have depth (layers: far sky/gradient → mid-ground details → near-ground texture) that fits the user's requested Atmosphere.
- Strictly adhere to the requested Visual Style (${specSheet.visualStyle}) and Atmosphere (${specSheet.atmosphere}).
- Every requested function in renderManifest must actually exist on window.RenderEngine.
- Prefer resilient stylized silhouettes and readable shapes over ultra-complex art that is likely to break.
- The shared scaffold shell will call your functions on frame zero, so drawBackground and drawHUD must be safe and deterministic immediately.

API CONTRACT — output ONLY this JavaScript object, nothing else:

window.RenderEngine = {
${(specSheet.renderManifest && specSheet.renderManifest.length > 0 ? specSheet.renderManifest : ['drawHero', 'drawEnemy', 'drawObstacle', 'drawProjectile', 'drawPickup', 'drawParticle']).map(fnName => `    ${fnName}: function(ctx, x, y, w, h, time) {\n        // REQUIRED: Fully generative canvas drawing sequence for ${fnName}\n    }`).join(',\n')}
    ,
    drawBackground: function(ctx, width, height, scrollX, scrollY, time) {
        // REQUIRED: Multi-layer parallax background. At least 3 depth layers.
        // scrollX/scrollY = camera offset for parallax. time = animation.
    },
    drawHUD: function(ctx, width, height, score, health) {
        // REQUIRED: Heads-up display with score text + health bar + stylized frame.
    }
};

OUTPUT ONLY THE JAVASCRIPT OBJECT. No markdown fences. No explanation. No HTML.`;
}

// ─────────────────────────────────────────────────────────
// PHASE 2B: ENGINEER-CODER (Dedicated Physics/Logic)
// ─────────────────────────────────────────────────────────
export function buildPhase2B_Engineer(specSheet, generatedArtistCode, scaffold, scaffoldShell) {
  // Extract the exact function names the Artist actually generated to prevent name mismatches
  const exactFunctions = [];
  const regex = /draw[A-Z][a-zA-Z0-9_]+/g;
  let match;
  while ((match = regex.exec(generatedArtistCode)) !== null) {
      if (!exactFunctions.includes(match[0]) && match[0] !== 'drawBackground' && match[0] !== 'drawHUD') {
          exactFunctions.push(match[0]);
      }
  }
  // Dedup and fallback
  let parsedManifest = exactFunctions.length > 0 ? exactFunctions : (specSheet.renderManifest || ['drawHero', 'drawEnemy', 'drawObstacle']);
  const scaffoldJson = JSON.stringify(scaffold || {}, null, 2);

  return `You are an elite HTML5 Game Engineer. Build a COMPLETE mobile game as a single HTML file.
You are strictly in charge of physics, inputs, state, and the game loop.
DO NOT WRITE ART LOGIC. All entity rendering is handled by the Artist API Contract.

GAME SPECIFICATION:
- Title: ${specSheet.title}
- Genre: ${specSheet.genre}
- Summary: ${specSheet.summary}
- Core Mechanics: ${JSON.stringify(specSheet.coreMechanics)}
- Runtime Lane: ${specSheet.runtimeLane || 'arcade_canvas'}
- Playable Slice: ${specSheet.playableSlice || 'One compact mobile game scene.'}
- Scene Blueprint: ${specSheet.sceneBlueprint || 'A readable stage with one hero and one threat type.'}
- Control Model: ${specSheet.controlModel || 'Simple touch-first interaction.'}

SHARED SCAFFOLD CONTRACT:
${scaffoldJson}

START FROM THIS SCAFFOLD HTML SHELL AND PRESERVE ITS BOOT SHAPE, RUNTIME OBJECTS, AND FIRST-FRAME GUARANTEES:
\`\`\`html
${scaffoldShell}
\`\`\`

SPECTACLE FOCUS:
${formatPromptList(specSheet.spectacleFocus, '- impact flashes')}

PLAYABILITY RULES:
${formatPromptList(specSheet.playabilityRules, '- Prefer one polished gameplay loop over sprawling feature lists.')}

${specSheet.runtimeLane === 'auto_battler_arena' ? `AUTO-BATTLER EXECUTION NOTE:
- Use a short prep phase with a visible BATTLE button.
- Keep active fighters to a readable squad and staged goblin waves.
- Sell "hundreds of goblins" with spawn gates, queues, dust, corpse decals, and effects instead of true large-scale ragdoll simulation.
- Heavy units should feel powerful through knockback, hit-stop, and wide attack arcs.
` : ''}

API CONTRACT (CRITICAL):
You MUST use native Canvas2D.
An Architect has explicitly designed the RenderEngine for this game. It will be automatically injected.
⚠️ FATAL RULE: DO NOT ATTEMPT TO WRITE OR DEFINE \`window.RenderEngine\` IN YOUR CODE! 
If you write \`window.RenderEngine = {}\` in your script, it will overwrite the Artist's code and ruin the game!
Assume \`window.RenderEngine\` exists globally. Your ONLY job is to CALL these functions inside your game loop:
\`\`\`javascript
${parsedManifest.map(fn => `window.RenderEngine.${fn} = function(ctx, x, y, width, height, time) {};`).join('\n')}
window.RenderEngine.drawBackground = function(ctx, width, height, scrollX, scrollY, time) {};
window.RenderEngine.drawHUD = function(ctx, width, height, score, health) {};
\`\`\`
In your game loop, you MUST track elapsed time and pass it to draw functions for animation:
\`const time = performance.now() / 1000;\`

REQUIRED DRAW CALLS in your render loop (Always subtract camera.x/camera.y from world coordinates!):
\`window.RenderEngine.drawBackground(ctx, canvas.width, canvas.height, camera.x||0, camera.y||0, time);\`
${parsedManifest.filter(fn => fn !== 'drawBackground' && fn !== 'drawHUD').map(fnName => `\`window.RenderEngine.${fnName}(ctx, entity.x - camera.x, entity.y - camera.y, entity.width, entity.height, time);\` // Use this for ${fnName.replace('draw', '')}`).join('\n')}
\`window.RenderEngine.drawHUD(ctx, canvas.width, canvas.height, score, health);\`

RULES:
1. Output ONE continuous HTML file starting with <!DOCTYPE html>.
2. Do not include external libraries.
3. Mobile-first touch controls (pointerdown/pointerup).
4. Fullscreen Canvas2D (resize loop).
5. Implement Juiciness (screen shake, physics easing).
6. BOOT RELIABILITY (CRITICAL):
   - The game must boot immediately at top level. Do NOT wait for DOMContentLoaded or window.onload.
   - Create the canvas and first frame synchronously so the mobile WebView does not sit on a blank screen.
   - Wrap boot code in try/catch and render a visible on-screen error panel if initialization fails.
   - The opening frame must draw a visible background and menu text. Never leave the screen blank while waiting for input.
7. LEVEL GENERATION (${specSheet.levelDesign || 'Dynamic'}):
   - If Endless: Procedurally generate platforms/enemies infinitely as player moves.
   - If Area/Single Screen: Confine bounds to canvas dimensions.
   - If Linear: Design distinct logical transitions or waves.
8. SENSE OF ALIGNMENT: Ensure physics, entity speeds, and platform alignments are spaced logically so the game is mathematically playable and flows smoothly without impossible gaps.
9. PROPER SCALE & MOVEMENT (CRITICAL): Under NO CIRCUMSTANCES should any entity (hero, enemy, platform) have a width or height of 1. Use realistic pixel dimensions (e.g. Hero: 60x80, Enemy: 50x50, Platforms: 100x20). Also, ensure the hero physically MOVES (updates x/y axis) if the game is endless.
10. CAMERA SHIFTS (CRITICAL): When calling your RenderEngine functions (drawHero, drawEnemy, etc.), you MUST pass Screen Coordinates by subtracting your game camera. You MUST do: \`window.RenderEngine.drawHero(ctx, hero.x - camera.x, hero.y - camera.y, ...)\`. Otherwise, the hero will walk completely off the Canvas screen!
11. NO PLACEHOLDERS (CRITICAL): You MUST write the absolutely complete physics loop and game update math yourself! DO NOT leave "// Placeholder" comments for logic! You are building the final production build right now. Do not skip any core functionality.
12. IMPLEMENT: Score tracking, health system, particle effects on hits/kills, and pickup collectibles.
13. SCOPE CONTROL:
   - If the prompt asks for an enormous cinematic game, compress it into one excellent playable scene or wave-based loop.
   - Fake scale with spawning, particles, layered backgrounds, damage numbers, hit flashes, and camera shake instead of overengineering.
14. RENDER CONTRACT:
   - Draw background every frame.
   - Draw at least one hero/player unit and one enemy/threat within the first second.
   - Ensure the game still looks intentional even before the user taps start.
15. SHARED-SHELL CONTRACT:
   - Preserve the existing scaffold shell structure instead of inventing a new one from scratch.
   - Keep the first-frame visibility guarantees from the scaffold.
   - Expand the placeholder update logic into the final working game.
   - Do not remove the RenderEngine call pattern.
   - Remove any scaffold placeholder markers like TODO_ENGINE from the final output.

OUTPUT FORMAT: Return ONLY HTML code, no markdown wrappers.`;
}

export function buildPhase3_Repair(specSheet, scaffold, scaffoldShell, artistGeneratedJS, engineHtml, compiledHtml, crashLog) {
  return `You are the integration lead repairing a broken DreamStream game build.
The Artist and Engineer must now be repaired TOGETHER so the merged artifact boots.

GAME SPEC:
${JSON.stringify(specSheet, null, 2)}

SHARED SCAFFOLD:
${JSON.stringify(scaffold || {}, null, 2)}

SCAFFOLD SHELL:
\`\`\`html
${scaffoldShell}
\`\`\`

CURRENT ARTIST CODE:
\`\`\`javascript
${artistGeneratedJS}
\`\`\`

CURRENT ENGINE HTML:
\`\`\`html
${engineHtml}
\`\`\`

CURRENT COMPILED HTML:
\`\`\`html
${compiledHtml}
\`\`\`

CRASH REPORT:
${crashLog}

TASK:
- Analyze whether the crash lives in the artist code, the engineer code, or their integration boundary.
- Repair BOTH sides if necessary so the merged game boots reliably.
- Keep the same game fantasy and scaffolded structure.
- The fixed code must preserve the RenderEngine contract and the engineer shell contract.

OUTPUT FORMAT (MANDATORY):
===ARTIST_CODE===
(complete artist JavaScript object)
===ENGINE_CODE===
(complete engine HTML document starting with <!DOCTYPE html>)

RULES:
- Output BOTH sections every time.
- No markdown fences.
- No explanation.
- No placeholders or ellipses.
- Make boot reliability the top priority over extra features.`;
}

export function buildPhase2C_Critic(specSheet, scaffold, scaffoldShell, artistGeneratedJS, engineHtml) {
  return {
    system: `You are the collaboration critic for a mobile HTML5 canvas game team.
Your job is to review the ARTIST code and ENGINEER code together and decide what must be revised before merge.

IMPORTANT RULES:
- Output ONLY raw JSON.
- Focus on playability, contract mismatches, boot safety, missing interactions, and visual/gameplay alignment.
- Be concise and specific.
- Prefer a short revision list over long essays.`,
    user: `GAME SPEC:
${JSON.stringify(specSheet, null, 2)}

SHARED SCAFFOLD:
${JSON.stringify(scaffold || {}, null, 2)}

SCAFFOLD SHELL:
\`\`\`html
${scaffoldShell}
\`\`\`

ARTIST CODE:
\`\`\`javascript
${artistGeneratedJS}
\`\`\`

ENGINE HTML:
\`\`\`html
${engineHtml}
\`\`\`

Return JSON:
{
  "shouldRevise": true,
  "artistFeedback": ["specific art/render fix"],
  "engineerFeedback": ["specific gameplay/boot fix"],
  "jointRisks": ["integration mismatch or runtime risk"],
  "collaborationSummary": "one short sentence about how the two should align"
}

Rules:
- artistFeedback and engineerFeedback should each contain 0 to 4 short actionable notes.
- jointRisks should call out contract mismatches, not vague complaints.
- If the build already looks coherent, set shouldRevise to false.
- Prioritize missing play loop, missing interaction, bad render contract usage, and dead-screen risks.

Output ONLY JSON.`
  };
}

export function buildPhase2D_ArtistRevision(specSheet, scaffold, artistGeneratedJS, criticNotes) {
  return `You are the procedural artist revising your RenderEngine after team review.
Keep the existing game fantasy, but fix the issues called out by the critic so the engineer can integrate cleanly.

GAME SPEC:
${JSON.stringify(specSheet, null, 2)}

SHARED SCAFFOLD:
${JSON.stringify(scaffold || {}, null, 2)}

CURRENT ARTIST CODE:
${artistGeneratedJS}

CRITIC FEEDBACK FOR ARTIST:
${formatPromptList(criticNotes?.artistFeedback, '- no direct artist changes requested')}

JOINT RISKS:
${formatPromptList(criticNotes?.jointRisks, '- no joint risks reported')}

COLLABORATION SUMMARY:
${criticNotes?.collaborationSummary || 'Keep the render API easy for the engineer to call correctly.'}

RULES:
- Output the COMPLETE window.RenderEngine object.
- Keep the same function names unless the scaffold contract demands otherwise.
- Make drawBackground and drawHUD safe on frame zero.
- Favor readable, robust silhouettes over brittle complexity.
- Output ONLY JavaScript, no markdown, no explanation.`;
}

export function buildPhase2E_EngineerRevision(specSheet, scaffold, scaffoldShell, artistGeneratedJS, engineHtml, criticNotes) {
  return `You are the HTML5 game engineer revising your implementation after team review.
Keep the existing scaffolded game structure, but fix the interaction, playability, and integration problems called out by the critic.

GAME SPEC:
${JSON.stringify(specSheet, null, 2)}

SHARED SCAFFOLD:
${JSON.stringify(scaffold || {}, null, 2)}

SCAFFOLD SHELL:
\`\`\`html
${scaffoldShell}
\`\`\`

CURRENT ARTIST CODE:
\`\`\`javascript
${artistGeneratedJS}
\`\`\`

CURRENT ENGINE HTML:
\`\`\`html
${engineHtml}
\`\`\`

CRITIC FEEDBACK FOR ENGINEER:
${formatPromptList(criticNotes?.engineerFeedback, '- no direct engineer changes requested')}

JOINT RISKS:
${formatPromptList(criticNotes?.jointRisks, '- no joint risks reported')}

COLLABORATION SUMMARY:
${criticNotes?.collaborationSummary || 'Preserve the shared shell and make the game actually playable.'}

RULES:
- Output the COMPLETE HTML document.
- Preserve the scaffolded boot shape and first-frame guarantees.
- Use the artist render functions exactly as provided.
- Remove placeholder behavior and ensure the first interaction leads to a real play loop.
- Output ONLY HTML, no markdown, no explanation.`;
}

export function buildPhase2F_Integrator(specSheet, scaffold, scaffoldShell, artistGeneratedJS, engineHtml, criticNotes) {
  return `You are the intelligent integration lead for a mobile HTML5 canvas game team.
Your job is to merge the ARTIST and ENGINEER outputs into one coherent final build plan before technical packaging happens.

GAME SPEC:
${JSON.stringify(specSheet, null, 2)}

SHARED SCAFFOLD:
${JSON.stringify(scaffold || {}, null, 2)}

SCAFFOLD SHELL:
\`\`\`html
${scaffoldShell}
\`\`\`

ARTIST CODE:
\`\`\`javascript
${artistGeneratedJS}
\`\`\`

ENGINE HTML:
\`\`\`html
${engineHtml}
\`\`\`

CRITIC NOTES:
${JSON.stringify(criticNotes || {}, null, 2)}

TASK:
- Resolve any remaining mismatches between render code and gameplay code.
- Keep the best parts of both outputs instead of blindly rewriting from scratch.
- Ensure the engineer HTML calls the artist render API correctly.
- Keep the scaffolded structure and first-frame/playability guarantees.
- Prefer robust alignment over flashy but brittle code.

OUTPUT FORMAT (MANDATORY):
===ARTIST_CODE===
(complete final artist JavaScript object)
===ENGINE_CODE===
(complete final engine HTML document starting with <!DOCTYPE html>)

RULES:
- Output BOTH sections every time.
- No markdown fences.
- No explanation.
- Do not drop working functionality unless it conflicts with boot safety or playability.
- Remove any TODO placeholders or dead shell behavior from the final output.`;
}

export function compileMultiAgentGame(artistGeneratedJS, engineHtml, options = {}) {
    const renderManifest = normalizeList(options.renderManifest, []);
    const renderFns = Array.from(new Set([...renderManifest, 'drawBackground', 'drawHUD']));
    const renderEngineStubScript = `\n<script id="render-engine-stubs">
window.RenderEngine = window.RenderEngine || {};
(function() {
  var noop = function() {};
  noop.__dreamstreamStub = true;
  ${renderFns.map((fnName) => `if (typeof window.RenderEngine.${fnName} !== 'function') window.RenderEngine.${fnName} = noop;`).join('\n  ')}
})();
</script>\n`;
    const artistScript = `\n<script id="artist-engine">
// MULTI-AGENT PROCEDURAL GRAPHICS
try {
\n${artistGeneratedJS}\n
} catch(e) { console.error("Artist-Coder Syntax Error", e); }
</script>\n`;

    // 3. Robust injection before the main game logic begins
    if (engineHtml.includes('</head>')) {
        return engineHtml.replace('</head>', renderEngineStubScript + artistScript + '</head>');
    } else if (engineHtml.includes('<script')) {
        return engineHtml.replace('<script', renderEngineStubScript + artistScript + '<script');
    } else {
        return renderEngineStubScript + artistScript + engineHtml;
    }
}
