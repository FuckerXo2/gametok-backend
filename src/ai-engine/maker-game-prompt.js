// Claude-style Phaser game generation prompt — v2 catalog pipeline.
// Flow: design plan (grounded in the v2 catalog summary) → entity-level RAG for the plan's SPRITE
// entities only → dominant-pack coherence re-rank → builder prompt with per-asset atlas contracts.
// Environment/props/UI are code-drawn by design; there are no environment sprites anymore.

import { listRequiredEntities } from './asset-selection.js';
import { retrieveAssetsForEntities, getCatalogSummary } from './asset-retrieval.js';
import { designGamePlan, formatPlanForBuilder } from './game-design.js';
import { loadAllThreeJSSkills } from './maker-composition-guidance.js';

/**
 * Detect whether the game should use the Three.js AAA skills.
 * Primary signal: the LLM design step classifies dimension as "3D" in the plan.
 * Fallback: minimal keyword check only when the design step failed (plan is null).
 */
function detect3D(userPrompt, plan) {
    // Trust the LLM's classification when available
    if (plan?.dimension === '3D') return true;
    if (plan?.dimension === '2D') return false;
    // Fallback only when plan is null (design step failed) — basic keyword sniff
    const p = (userPrompt || '').toLowerCase();
    return /\b(3d|three[\s.-]?js|threejs)\b/.test(p);
}

/**
 * Fallback orientation from the raw prompt, used only when the design step fails. Defaults to
 * 'side' — the v2 catalog is overwhelmingly side-view (144 side vs ~10 top_down), so side is the
 * orientation we can actually cast.
 */
function detectOrientation(prompt) {
  const p = prompt.toLowerCase();
  if (/\b(isometric|iso|axonometric)\b/.test(p)) return 'isometric';
  if (/\b(top-?down|topdown|overhead|birds?-?eye)\b/.test(p)) return 'top_down';
  return 'side';
}

// Role headers for the AVAILABLE ASSETS list. v2 retrieval only produces character (incl.
// creatures) and vehicle roles — everything else in a game is code-drawn.
const ROLE_LABEL = {
  character: 'CHARACTERS / CREATURES (catalog sprites)',
  vehicle: 'VEHICLES (catalog sprites)',
};

// Native pixel sizes across the catalog vary wildly within the same role (16px pixel-art next to
// 512px hi-res packs). Left to the model this produces mismatched scale (a 720px character next to a
// 12px obstacle). So we compute a fixed ON-SCREEN target per role (calibrated to a ~390px-wide
// portrait phone; real device widths are 390–430px so these hold) and hand the model the exact
// display size to use, instead of asking it to reason about scaling itself.
const ROLE_TARGET_PX = { vehicle: 56, character: 48 };
// Fit a native w×h into a `target`x`target` box (contain, not stretch).
function fitBox(w, h, target) {
  if (!target || !w || !h) return null;
  const scale = target / Math.max(w, h);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

// Emit a Phaser-ready summary for one CHARACTER (may carry multiple animations, each a separate
// physical sheet — see asset-retrieval.js header comment). One display-size box is computed from
// the primary (first-listed) animation and applied to every animation of this character so it
// doesn't visually resize when switching pose.
function formatV2AssetLine(a, role) {
  const key = `v2_${a.id.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
  const tags = `${a.species}·${a.perspective}·${a.playable_role}`;

  // STATIC: single image, no animation frames — load as a plain image and move it with code.
  if (a.motion === 'static') {
    const disp = fitBox(a.canvas_size?.w, a.canvas_size?.h, ROLE_TARGET_PX[role]);
    const targetDisplay = disp ? ` → setDisplaySize(${disp.w}, ${disp.h})` : '';
    return (
`- **${a.description}** [${tags}·STATIC]
    key: '${key}'  native ${a.canvas_size?.w}x${a.canvas_size?.h}${targetDisplay}
    image: ${a.image_url}
    → STATIC sprite (no animation). preload: this.load.image('${key}', '${a.image_url}'). Draw with this.add.image/sprite and move it with code (x/y velocity, setRotation, setScale). Do NOT call anims.create/play on this.`
    );
  }

  // ANIMATED: one or more named poses, each its OWN spritesheet PNG on R2 (never packed together).
  // Each pose gets its own texture key `${key}_${animName}` + its own load.spritesheet call (native
  // frame size differs per pose) + its own anims.create — then sprite.play('walk') / .play('attack')
  // switches texture automatically, Phaser handles that.
  const animNames = Object.keys(a.animations);
  const primary = a.animations[animNames[0]];
  const disp = fitBox(primary.canvas_size.w, primary.canvas_size.h, ROLE_TARGET_PX[role]);
  const targetDisplay = disp ? ` → setDisplaySize(${disp.w}, ${disp.h}) [use this SAME box for every pose below]` : '';
  const poseLines = animNames.map(name => {
    const def = a.animations[name];
    const poseKey = `${key}_${name}`;
    return `    - '${name}': preload this.load.spritesheet('${poseKey}', '${def.sheet_url}', { frameWidth: ${def.canvas_size.w}, frameHeight: ${def.canvas_size.h} }); anims.create({ key: '${name}', frames: this.anims.generateFrameNumbers('${poseKey}', { start: 0, end: ${def.frame_count - 1} }), frameRate: ${def.fps}, repeat: ${def.loop ? -1 : 0} }); sprite.play('${name}')`;
  }).join('\n');
  return (
`- **${a.description}** [${tags}·ANIMATED, ${animNames.length} pose(s): ${animNames.join(', ')}]
    key base: '${key}'${targetDisplay}
    → ANIMATED. Each pose is a separate spritesheet — set up ALL of them in preload()/create(), then call sprite.play(name) to switch:
${poseLines}`
  );
}

function formatGroupedAssets(grouped) {
  const roles = Object.keys(grouped);
  if (!roles.length) return '(No catalog assets matched — draw code fallbacks.)';
  let out = '';
  for (const role of roles) {
    out += `\n## ${ROLE_LABEL[role] || role.toUpperCase()}\n`;
    for (const a of grouped[role]) {
      out += formatV2AssetLine(a, role) + '\n\n';
    }
  }
  return out;
}

// Fold flat entity-retrieval matches into {role: [...]} shape for formatGroupedAssets()
// (role headers + per-role setDisplaySize sizing).
function groupByRole(assets, perRole) {
    const grouped = {};
    for (const a of assets) {
        if (!a.role) continue;
        (grouped[a.role] ||= []).push(a);
    }
    for (const role of Object.keys(grouped)) grouped[role] = grouped[role].slice(0, perRole);
    return grouped;
}

// Visual-coherence re-rank: find the dominant source_pack among all retrieved matches, then within
// each entity's matches boost same-pack items (+0.18, gated at a 0.50 plausibility floor — same
// calibration as asset-retrieval.js) and keep the top `keep`. One game's cast should come from one
// art style where possible: a toon zombie next to a toon adventurer, not next to a rendered zombie.
function coherenceRerank(results, keep = 2) {
    const packCounts = {};
    for (const r of results) for (const m of r.matches) {
        if (m.source_pack) packCounts[m.source_pack] = (packCounts[m.source_pack] || 0) + 1;
    }
    const dominant = Object.entries(packCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    for (const r of results) {
        r.matches = r.matches
            .map(m => ({ ...m, _score: m.score + (dominant && m.source_pack === dominant && m.score >= 0.50 ? 0.18 : 0) }))
            .sort((a, b) => b._score - a._score)
            .slice(0, keep);
    }
    return { results, dominant };
}

export async function buildGamePrompt(userPrompt) {
    // v2 pipeline:
    //   1. DESIGN — Flash produces a structured plan grounded in the REAL v2 catalog summary
    //      (species/counts/perspectives/animated-vs-static). Every entity is tagged sprite|code.
    //   2. RETRIEVE — entity-level RAG over v2 embeddings, but ONLY for the plan's sprite entities
    //      (characters/creatures/vehicles). Code-drawn entities never touch the catalog.
    //   3. COHERENCE — re-rank retrieved matches toward the dominant source pack so one game's cast
    //      shares an art style.
    //   4. BUILD PROMPT — per-asset atlas contracts (animated: load.atlas + anims; static:
    //      load.image + move with code) + the plan as explicit marching orders.
    // If the design step fails, degrade to a shallow entity list off the raw prompt (all treated as
    // sprite candidates). If retrieval finds nothing, the game is fully code-drawn — that's valid.
    let orientation = null;
    let plan = null;
    let spriteEntityNames = [];

    const catalogSummary = getCatalogSummary();
    const plannedResult = await designGamePlan(userPrompt, { catalogSummary });
    if (plannedResult) {
        plan = plannedResult;
        orientation = plan.orientation;
        spriteEntityNames = plan.entities.filter(e => e.render === 'sprite').map(e => e.name);
    } else {
        spriteEntityNames = await listRequiredEntities(userPrompt);
        orientation = detectOrientation(userPrompt);
    }

    let grouped = {};
    if (spriteEntityNames.length) {
        const raw = await retrieveAssetsForEntities(spriteEntityNames, {
            topKPerEntity: 4,
            orientation,
            softOrientation: true, // side-view player on a top-down concept beats NO player
        });
        const { results, dominant } = coherenceRerank(raw, 2);
        if (dominant) console.log(`🎨 Coherence anchor pack: ${dominant}`);

        // Similarity floor: the catalog has no entry for some concepts (a literal snake, a piano
        // key). Without a floor the weakest available match still gets returned and the builder
        // is told "you MUST show it" — forcing a wrong sprite (a fantasy monster as a snake head)
        // into a game that has nothing to do with it. Calibrated against real data: genuine matches
        // score 0.6-0.8 (basketball player 0.68, knight 0.67-0.84, zombie 0.69); the observed
        // garbage-tier case (snake head -> random monster) scored 0.32. 0.42 sits well below every
        // real match seen and well above the one confirmed bad one.
        const MIN_SPRITE_SCORE = 0.42;
        const downgraded = [];
        for (const r of results) {
            const survivors = r.matches.filter(m => m._score >= MIN_SPRITE_SCORE);
            if (!survivors.length && r.matches.length) downgraded.push(r.entity);
            r.matches = survivors;
        }
        if (downgraded.length) {
            console.log(`⬇️  No good sprite match (score < ${MIN_SPRITE_SCORE}) for: [${downgraded.join(', ')}] — reclassified to code-drawn`);
            if (plan) for (const e of plan.entities) if (downgraded.includes(e.name)) e.render = 'code';
        }

        const flat = [];
        const seen = new Set();
        for (const r of results) for (const m of r.matches) {
            if (seen.has(m.id)) continue;
            seen.add(m.id);
            flat.push(m);
        }
        if (flat.length) grouped = groupByRole(flat, 10);
    }

    const assetList = Object.keys(grouped).length
      ? formatGroupedAssets(grouped)
      : '(No catalog sprites matched this concept — every entity in this game is code-drawn. Draw them WELL with layered graphics.)';
    // Detect if this is a 3D game and load the AAA Three.js skills if so
    const is3D = detect3D(userPrompt, plan);
    let threejsSkillsBlock = '';
    if (is3D) {
        const skills = loadAllThreeJSSkills();
        if (skills) {
            console.log('🎮 3D game detected — injecting Three.js AAA skills into builder prompt');
            threejsSkillsBlock = `\n\n=== THREE.JS GAMEPLAY & GRAPHICS SKILLS ===\nREAD THE FOLLOWING SKILLS CAREFULLY AND APPLY THEM TO THIS GAME. THIS IS YOUR PRIMARY ARCHITECTURE AND GAME-FEEL GUIDANCE:\n${skills}\n=== END THREE.JS SKILLS ===\n`;
        }
    }

    return {
        system: `You are an expert game developer. Your job is to write a complete, working, mobile-friendly HTML5 web game directly in the project directory using HTML, CSS, and JavaScript.

# CHOOSE YOUR ENGINE
You can choose the technology stack that fits the game:
1. Vanilla HTML5 Canvas (Lighter, faster, recommended for simple 2D games)
2. Phaser 3 or Phaser 4 (Loaded via public CDN in index.html)
3. Three.js (For 3D games, loaded via public CDN)
4. CSS/DOM (For simple puzzle or card games)

Load any required game engine/libraries via standard public CDN <script> tags in index.html (e.g. from https://cdnjs.cloudflare.com/ or https://cdn.jsdelivr.net/). Do NOT use npm install or npm packages.

# AVAILABLE ASSETS

Use these assets from the catalog (already hosted and ready to use):

${assetList}

**CRITICAL**: Use ONLY the assets listed above, via the exact full URLs shown per asset. They are guaranteed live. Do NOT invent other asset URLs — nothing else exists.

**HOW TO LOAD SPRITES:**
- For Phaser/Three.js or Canvas: load these direct HTTP image URLs into your engine.
- For animated sprites: if poses (like walk, idle, attack) are listed, each pose is its own separate PNG file. Set up each pose and swap between them in your code.
- Size every sprite explicitly in your code based on the dimensions or guidelines suggested. Never render at native pixel size because native resolutions in the catalog vary wildly.

# CRITICAL RULES

1. **Multi-File Structure**: Organize your code across standard files:
   - index.html: Minimal HTML5 entrypoint that loads CSS and JS files, and imports any library scripts via public CDNs.
   - main.js: Main game logic (using ES modules if you split code into multiple JS files).
   - style.css: CSS layout and styling.

2. **Touch-First Controls**: The game runs on mobile phones inside a WebView. It must be fully playable with finger dragging and tapping. Keyboard (WASD) can exist only as a secondary desktop fallback.
   - Move: The player should follow the finger (pointermove/drag/lerp) or tap locations.
   - Act (shoot/jump/flap): Trigger on pointerdown/tap.

3. **Responsive Fullscreen**: The game must dynamically fill 100% of the screen. Read window width/height dynamically; never hardcode a fixed size like 390x844. Keep all HUD text, scores, timers, and buttons within a safe area (y ∈ [10%, 90%], x ∈ [5%, 95%]) so they are not cut off. Set html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000}.

4. **Designed Environments**: Environments must look visually appealing (gradients, layers, textured ground, details). Banned: a single flat background color, or plain wireframe grid.

5. **HUD Design**: Design a unique, beautiful HUD (custom font, score, health/lives with matching icons, restart buttons) themed to this game.

6. **Juice**: Add screen shake, visual feedback, or particles to make the game feel premium.

7. **Pure JavaScript**: Use standard JS (.js files). No TypeScript.
${threejsSkillsBlock}`,
        user: `Create a complete web game based on this description:

${userPrompt}
${plan ? '\nGame Plan:\n' + formatPlanForBuilder(plan) + '\n' : ''}
`
    };
}
