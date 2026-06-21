import fs from 'fs';
import path from 'path';

import { getMakerFileJsonEncodingRuleLines, getMakerFileJsonSchemaExample, normalizeMakerProtocolResponse } from './maker-agent-response.js';
import { buildAllowedAssetKeysPromptBlock } from './maker-agent-asset-keys.js';
import {
    getMakerAgentToolInstructionLines,
    MAKER_AGENT_TURN_MODE_IMPLEMENT,
    MAKER_AGENT_TURN_MODE_REPAIR,
} from './maker-agent-tools.js';
import { buildCompositionGuidancePromptBlock, summarizeCompositionForImplement } from './maker-composition-guidance.js';
import { isFreeBuildMode } from './maker-factory-mode.js';
import { getMakerSystemManualBlock } from './maker-system-manual.js';

function extractJson(text) {
    const source = String(text || '');
    const jsonStart = source.indexOf('{');
    const jsonEnd = source.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd >= jsonStart) {
        return source.substring(jsonStart, jsonEnd + 1);
    }
    return source;
}

function stripMarkdownFences(text) {
    return String(text || '')
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

export function summarizeMakerProjectFiles(projectFiles = []) {
    return (Array.isArray(projectFiles) ? projectFiles : []).map((file) => ({
        path: file.path || null,
        chars: String(file.content || '').length,
        truncated: Boolean(file.truncated),
        kind: /\.css$/i.test(file.path || '') ? 'css'
            : /\.js$/i.test(file.path || '') ? 'js'
            : /\.json$/i.test(file.path || '') ? 'json'
            : 'html',
    }));
}

const MAKER_AGENT_FILE_PROMPT_CHARS = Math.max(
    4000,
    Math.min(24000, Number(process.env.GAMETOK_MAKER_AGENT_FILE_PROMPT_CHARS || 12000)),
);
const MAKER_IMPLEMENT_GDD_CHARS = Math.max(
    4000,
    Math.min(32000, Number(process.env.GAMETOK_MAKER_IMPLEMENT_GDD_CHARS || 14000)),
);
const MAKER_IMPLEMENT_MAIN_TS_CHARS = Math.max(
    4000,
    Math.min(20000, Number(process.env.GAMETOK_MAKER_IMPLEMENT_MAIN_TS_CHARS || 10000)),
);
const MAKER_REPAIR_GDD_CHARS = Math.max(
    2000,
    Math.min(12000, Number(process.env.GAMETOK_MAKER_REPAIR_GDD_CHARS || 4000)),
);
const MAKER_REPAIR_EVIDENCE_TASKS = Math.max(2, Math.min(12, Number(process.env.GAMETOK_MAKER_REPAIR_EVIDENCE_TASKS || 6)));

function pickProjectFileContent(projectFiles = [], filePath, maxChars = MAKER_AGENT_FILE_PROMPT_CHARS) {
    const file = (Array.isArray(projectFiles) ? projectFiles : []).find((entry) => entry.path === filePath);
    if (!file) return null;
    const content = String(file.content || '');
    if (content.length <= maxChars) {
        return { path: filePath, content, truncated: false };
    }
    return {
        path: filePath,
        content: `${content.slice(0, maxChars)}\n/* ... stub truncated (${content.length} chars total) — replace entire file via write_file. */`,
        truncated: true,
        originalChars: content.length,
    };
}

function summarizeFoundationForImplement(foundation = null) {
    if (!foundation || typeof foundation !== 'object') return null;
    return {
        foundationId: foundation.foundationId || null,
        lane: foundation.lane || null,
        requiredState: foundation.requiredState || [],
        requiredFunctions: foundation.requiredFunctions || [],
        probeMethods: foundation.probeMethods || [],
        firstFrame: foundation.firstFrame || null,
        acceptanceChecks: foundation.acceptanceChecks || [],
        implementationNotes: foundation.implementationNotes || [],
        hudDesign: foundation.hudDesign || null,
        composition: summarizeCompositionForImplement(foundation),
        assetSlots: Array.isArray(foundation.assetSlots)
            ? foundation.assetSlots.map((slot) => ({
                id: slot?.id || slot?.role || null,
                role: slot?.role || null,
            }))
            : [],
    };
}

export function summarizeProjectFilesForPrompt(projectFiles = [], maxCharsPerFile = MAKER_AGENT_FILE_PROMPT_CHARS) {
    return (Array.isArray(projectFiles) ? projectFiles : []).map((file) => {
        const pathValue = file.path || null;
        const content = String(file.content || '');
        if (content.length <= maxCharsPerFile) {
            return { path: pathValue, content, truncated: false };
        }
        return {
            path: pathValue,
            content: `${content.slice(0, maxCharsPerFile)}\n/* ... truncated for prompt (${content.length} chars total). Copy find anchors from this excerpt only; lengthen find with nearby lines if needed. */`,
            truncated: true,
            originalChars: content.length,
        };
    });
}

export async function appendMakerAgentTurn(workspace, turns, turn) {
    const normalized = {
        index: (Array.isArray(turns) ? turns.length : 0) + 1,
        at: new Date().toISOString(),
        phase: turn.phase || 'unknown',
        objective: turn.objective || null,
        status: turn.status || 'complete',
        model: turn.model || null,
        filesRead: Array.isArray(turn.filesRead) ? turn.filesRead : [],
        editsApplied: Array.isArray(turn.editsApplied) ? turn.editsApplied : [],
        targetedRepairTasks: Array.isArray(turn.targetedRepairTasks) ? turn.targetedRepairTasks : [],
        sandbox: turn.sandbox || null,
        notes: Array.isArray(turn.notes) ? turn.notes.slice(0, 12) : [],
        error: turn.error || null,
    };
    turns.push(normalized);
    if (workspace) {
        await fs.promises.writeFile(
            path.join(workspace, 'maker-agent-loop.json'),
            JSON.stringify({
                version: 1,
                source: 'gametok-native-maker-agent-loop',
                turnCount: turns.length,
                turns,
            }, null, 2),
            'utf8'
        );
    }
    return normalized;
}

export function summarizeMakerAgentTurns(turns = []) {
    return {
        version: 1,
        source: 'gametok-native-maker-agent-loop-summary',
        turnCount: Array.isArray(turns) ? turns.length : 0,
        phases: Array.from(new Set((turns || []).map((turn) => turn.phase).filter(Boolean))),
        failedTurns: (turns || []).filter((turn) => turn.status === 'failed').length,
        editsApplied: (turns || []).reduce((sum, turn) => sum + (Array.isArray(turn.editsApplied) ? turn.editsApplied.length : 0), 0),
        targetedRepairTaskCount: (turns || []).reduce((sum, turn) => sum + (Array.isArray(turn.targetedRepairTasks) ? turn.targetedRepairTasks.length : 0), 0),
        turns: (turns || []).map((turn) => ({
            index: turn.index,
            phase: turn.phase,
            objective: turn.objective,
            status: turn.status,
            editsApplied: Array.isArray(turn.editsApplied) ? turn.editsApplied.map((edit) => edit.path) : [],
            targetedRepairTasks: Array.isArray(turn.targetedRepairTasks) ? turn.targetedRepairTasks.map((task) => task.id || task.directRepairTask).filter(Boolean) : [],
            error: turn.error || null,
        })),
    };
}

function truncatePromptText(text = '', maxChars = 4000, label = 'content') {
    const value = String(text || '');
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}\n\n/* ${label} truncated (${value.length} chars total). Use read_file for live source. */`;
}

function summarizeEvidenceForRepairPrompt(evidence = null) {
    if (!evidence || typeof evidence !== 'object') return null;
    const preflightIssues = Array.isArray(evidence?.diagnostics?.preflight?.issues)
        ? evidence.diagnostics.preflight.issues
        : [];
    return {
        success: evidence.success,
        phase: evidence.phase,
        crashes: Array.isArray(evidence.crashes) ? evidence.crashes.slice(0, 4) : [],
        preflightIssues: preflightIssues.slice(0, 8).map((issue) => ({
            id: issue.id,
            message: issue.message,
            missingSlots: issue.missingSlots || [],
            missingKeys: issue.missingKeys || [],
            repair: issue.repair || null,
        })),
        targetedRepairTasks: Array.isArray(evidence.targetedRepairTasks)
            ? evidence.targetedRepairTasks.slice(0, MAKER_REPAIR_EVIDENCE_TASKS)
            : [],
        failedContractChecks: Array.isArray(evidence.diagnostics?.failedContractChecks)
            ? evidence.diagnostics.failedContractChecks.slice(0, MAKER_REPAIR_EVIDENCE_TASKS)
            : [],
        buildFailure: evidence.diagnostics?.buildFailure
            ? {
                type: evidence.diagnostics.buildFailure.type,
                errors: (evidence.diagnostics.buildFailure.errors || []).slice(0, 6),
            }
            : null,
    };
}

function summarizeLoopHistoryForRepair(loopHistory = null) {
    const priorTurns = Array.isArray(loopHistory?.turns) ? loopHistory.turns : [];
    return {
        turnCount: loopHistory?.turnCount || priorTurns.length,
        editsApplied: loopHistory?.editsApplied || 0,
        targetedRepairTaskCount: loopHistory?.targetedRepairTaskCount || 0,
        turns: priorTurns.slice(-2),
    };
}

function summarizeTemplateContractForRepair(templateContract = null) {
    if (!templateContract || typeof templateContract !== 'object') return null;
    return {
        templateId: templateContract.templateId || templateContract.foundation?.foundationId || null,
        lane: templateContract.foundation?.lane || templateContract.lane || null,
        foundation: summarizeFoundationForImplement(templateContract.foundation),
    };
}

function summarizeAssetContractForRepair(assetContract = null) {
    if (!assetContract || typeof assetContract !== 'object') return null;
    const slots = Array.isArray(assetContract.slots) ? assetContract.slots : [];
    return {
        slotCount: slots.length,
        roles: slots.slice(0, 12).map((slot) => slot?.role || slot?.id || null).filter(Boolean),
    };
}

export function buildThreeDRulesBlock(foundation = null) {
    if (!foundation) return '';
    const dimension = String(foundation.dimension || '').toUpperCase();
    const lane = String(foundation.lane || '').toLowerCase();
    if (dimension !== '3D' && !lane.includes('threejs') && !lane.includes('voxel_world')) return '';
    const cameraRig = String(foundation.cameraRig || 'third_person_chase');
    return [
        '3D RULES (threejs-kernel):',
        "- DO NOT read_file src/threeAssets.ts or src/bootstrap.ts (read-only).",
        "- import * as THREE from 'three'. Use createThreeStage() from './threeAssets.ts' (already wired in main.ts). It provides renderer, scene, camera, lights, soft shadows, PBR env, and bloom. Do not create a second renderer or remove lights.",
        "- WebGL only, NO 2D canvas drawing (ctx).",
        `- Camera rig: ${cameraRig}. Smooth follow/look in stepGame.`,
        '- AUTHORED FORMS, NOT BARE PRIMITIVES: build recognizable silhouettes with voxelModel() (colored voxel cells -> premium blocky models, one draw call) and composed Box/Cylinder/Lathe/Extrude groups. A lone sphere/box with glow is NOT enough — give the player, enemies and props a real shape.',
        '- DENSITY: fill the world with InstancedMesh (grass, rocks, debris, crowds, coral, stars) — one draw call for thousands. Sparse scenes read as cheap.',
        "- MATERIALS: vary MeshStandardMaterial metalness/roughness per surface; use flat vs smooth shading deliberately; vertex/instance colors are free variety. EMISSIVE only for glowing accents (neon, engines, pickups) — the kernel bloom lights them.",
        "- PROCEDURAL TEXTURE (code, NO image files): import { proceduralTexture } from './threeAssets.ts' and call proceduralTexture('noise'|'gradient'|'checker'|'stripes'|'dots', { colorA, colorB, scale, repeat }) -> assign to material.map for sand/water/ground/panels instead of one flat color.",
        "- VFX + LIFE (code, NO assets): import { createParticleField, bobSway } from './threeAssets.ts'. createParticleField(scene,{color}) -> call .update(dt) each frame and .burst(pos,{count,speed,life}) on impacts/pickups/thrust for juice. bobSway(obj, t, { phase }) idle-animates props/creatures (gentle bob+sway) without rigs.",
        "- SKY + WATER (code, NO assets, the cinematic look): import { createSky, createWater } from './threeAssets.ts'. createSky(stage.scene, { elevation }) -> photoreal atmospheric sky (elevation ~3-8 = golden sunset, ~40 = midday); then align shadows with stage.sunLight.position.copy(sky.sun).multiplyScalar(80). createWater(stage.scene, { color, size }) -> reflective rippling water; call .update(t) each frame. Use these for any outdoor/ocean/sunset scene.",
        "- LIGHTING / TIME OF DAY: stage.sunLight (DirectionalLight) and stage.hemisphereLight are exposed — recolor/dim them for sunset/night moods and match scene.fog color to the sky. Colored point lights + fog do most of the cinematic 'mood' work.",
        "- TERRAIN + DENSITY (code, NO assets): import { createTerrain, scatter } from './threeAssets.ts'. A FLAT plane reads cheap — use createTerrain(stage.scene, { amplitude, flatShading }) for rolling ground and place the player/props with its .heightAt(x,z). Fill the world with scatter(stage.scene, geom, mat, { count, area, heightAt }) (grass/rocks/trees/debris/crowd) — one draw call for thousands. Empty scenes read cheap; dense ones read AAA.",
        "- JUICE (game feel, NO assets): import { tween, hitFlash, trail, floatingText } from './threeAssets.ts'. Keep returned handles in an array and call .update(dt) each frame, dropping ones that return true. tween({duration,ease:'outBack',onUpdate}) for squash-stretch pops on spawn/collect; hitFlash(mesh) on damage; trail(scene,{color}).push(pos) behind projectiles/movers; floatingText('+10', worldPos, stage.camera) on score. Juice is what makes it feel premium.",
        "- STYLIZED CREATURE (code, NO assets, the low-poly 'dragon/beast' path): import { composedCreature } from './threeAssets.ts'. composedCreature({ bodyColor, bellyColor, accentColor, legs, wings, tail, spikes }) -> a readable low-poly creature Group (body+head+snout+horns+legs+optional wings/tail/spikes). Move/rotate the Group; animate with bobSway(). Use this for animals/monsters/mounts instead of a lone sphere — a real silhouette beats a blob.",
        "- WORLD AXES: Camera sits at +Z looking down -Z (FORWARD = -Z). THE PLAY SPACE IS THE DEPTH AXIS: the world / obstacles / enemies live deep at -Z and travel toward the camera (+Z), growing as they approach.",
        '- MOVEMENT MODEL — pick by genre; all three are genuinely 3D, never collapse play to one flat axis:',
        '   (a) GROUND walkers / runners / drivers: steer on the X/Z plane; Y is gravity / jump.',
        '   (b) RAIL FLYER / SHOOTER (auto-forward, e.g. Star Fox, asteroid blaster): the player STRAFES on the X/Y screen plane while the WORLD travels in depth — obstacles spawn deep at -Z (e.g. z = -120) and rush toward the camera on +Z. Never spawn things from the screen EDGES sliding across X/Y.',
        '   (c) FREE-PILOT swim / fly / submarine / free-flight (e.g. Ecco the Dolphin, a bird, a sub, a free spaceship): the player CONTROLS ALL THREE AXES — forward thrust along facing, PITCH UP / DOWN (Y) and turn / strafe (X). The player MUST be able to go up, down AND forward, not only left/right. The world is an OPEN swimmable / flyable VOLUME with far, fog-faded boundaries and landmarks to travel toward in depth — NEVER a tight clamped box the player bumps into a few units out.',
        '   Collapsing any of these to a single flat axis (left/right-only, or +Y-up only), or trapping the player in a small hard-walled box, is a HARD FAILURE for a 3D game.',
        "- FREE-ROAM 3D (swim / open flight — dolphin, fish, bird, drone, submarine): the creature AUTO-MOVES FORWARD along its facing; the player STEERS with ONE thumb joystick — up = ascend/pitch up, down = dive, left/right = turn. That single joystick covers up/down AND left/right at once, so it stays one-handed — do NOT add a separate up/down button pair. NEVER lock the creature to a single left-right axis. Make the swim/fly volume roomy enough to travel through toward the creatures/goals — not a tiny box it only slides inside.",
        "- HUD: DOM in #hud, not canvas text. Use fixed-width fonts.",
        "- ON-SCREEN CONTROLS (MANDATORY, PHONE-FIRST): the game must be playable ONE-HANDED with a single thumb. Render visible touch controls in #controls-layer — ONE primary movement control (a thumb JOYSTICK) plus AT MOST one small ACTION button. Do NOT build laptop/keyboard-style layouts, and do NOT split movement across two hands (a joystick on the left AND up/down buttons on the right is WRONG — fold all steering into the one joystick). NEVER require tapping the player/entity itself to move or act. Controls visible on the first frame; the onboarding hint points at them.",
        "- SOLID COLLISION (MANDATORY): walls, buildings, cover and obstacles MUST physically block the player AND enemies every frame (AABB or radius check) — nothing may pass THROUGH a solid object. Projectiles stop/impact on solids instead of flying through them.",
        "- THIRD-PERSON / OVER-SHOULDER CAMERA: the chase camera must ALWAYS keep the player on-screen and roughly centred — lerp/clamp the follow so fast or full-3D movement can NEVER lose the player off-frame (no swimming/flying out of view). Follow the player's position AND facing smoothly; horizontal drag may rotate yaw to look/aim; do NOT hard-lock a single fixed angle.",
        "- USE THE KERNEL HELPERS for controls/camera/collision — import them from './threeAssets.ts' and do NOT hand-roll these; they are the reliable implementations of the three laws above:",
        "   * touchControls({ actionButton: true, actionLabel: 'FIRE', lookDrag: true }) -> renders the one-thumb joystick + action button into #controls-layer for you. Read input.move() (Vector2: x = right, y = screen-up), input.consumeAction()/input.actionHeld(), input.look() (drag delta for aim). This IS the control scheme — never build a tap-the-entity or two-hand layout.",
        "   * followCamera(stage.camera, { distance, height }) -> call cam.update(playerWorldPos, dt) every frame; cam.addYaw(input.look().x * 0.005) to aim/orbit; cam.shake(0.5) on hits. It clamps so the player can NEVER be lost off-screen — use it instead of writing your own follow maths.",
        "   * collisionWorld() -> world.addBox(center, size) / addSphere(center, r) / addMesh(mesh) for EVERY solid (walls, buildings, cover, ground props); call world.resolve(playerPos, radius) each frame so the player can't pass through, and world.hits(projectilePos) for impacts. This is how obstacles become solid.",
        ...((lane.includes('runner') || lane.includes('surfer') || lane.includes('dash')) && isFreeBuildMode() ? [
            '- RUNNER (FREE BUILD): Organize code across multiple files under src/. main.ts is the entry point. Export stepGame(dt), renderAll(), resetGame().',
        ] : (lane.includes('runner') || lane.includes('surfer') || lane.includes('dash')) ? [
            '- RUNNER (SINGLE FILE): Edit ONLY the marked region between GAMETOK:EDIT markers in main.ts. Do not rewrite the pre-wired engine.',
        ] : []),
        ...(lane.includes('racer') || lane.includes('racing') || lane.includes('kart') ? [
            '- RACER (SINGLE FILE): Everything lives in src/main.ts. Enhance the game-logic functions in place.',
        ] : []),
    ].join('\n');
}

export function buildUserMediaInstructionBlock(userMedia = null) {
    if (!userMedia) return '';
    const images = Array.isArray(userMedia.images) ? userMedia.images : [];
    const videos = Array.isArray(userMedia.videos) ? userMedia.videos : [];
    if (!images.length && !videos.length) return '';
    const lines = ['USER-PROVIDED MEDIA — the player deliberately attached these and told you how to use each one. Their instruction is the AUTHORITY: honor it exactly, even when it differs from the default role. You MUST use every one; never ignore them:'];
    for (const img of images) {
        const directive = img.instruction
            ? `The player said use it as: "${img.instruction}". Do exactly that — it overrides any default role.`
            : `Use it as the ${img.role}.`;
        if (img.animated) {
            lines.push(`- Animated image asset key "${img.key}" (a GIF/sticker — it MUST keep animating). ${directive} Render it as a positioned HTML <img> element layered over #game-canvas, src resolved at runtime: (window.DREAM_ASSET_PACK||[]).find(a => a.key === "${img.key}")?.url. Do NOT draw it with ctx.drawImage — that freezes a GIF to its first frame. Move/scale it with CSS transforms if it needs to travel around the screen.`);
        } else {
            lines.push(`- Image asset key "${img.key}". ${directive} Load it like other pack assets (getAssetImage("${img.key}") / firstByRole).`);
        }
    }
    for (const vid of videos) {
        const directive = vid.instruction
            ? `The player said use it as: "${vid.instruction}". Do exactly that.`
            : (vid.role === 'background'
                ? 'Use it as a full-bleed looping background behind gameplay.'
                : `Use it for the ${vid.role}.`);
        lines.push(`- Video asset key "${vid.key}". ${directive} Resolve its src at runtime: const src = (window.DREAM_ASSET_PACK||[]).find(a => a.key === "${vid.key}")?.url. Create an HTMLVideoElement (muted, loop, playsInline, autoplay) with that src, then draw it each frame with ctx.drawImage(videoEl, ...) or position a <video> under #game-canvas. Never leave it unused.`);
    }
    return lines.join('\n');
}

export function buildMakerAgentImplementPrompt({
    prompt = '',
    qualityIntent = {},
    projectFiles = [],
    templateContract = null,
    designBrief = '',
    objective = '',
    allowedAssetKeys = [],
    assetSlotHints = [],
    userMedia = null,
} = {}) {
    const foundation = templateContract?.foundation || null;

    const mainTs = pickProjectFileContent(projectFiles, 'src/main.ts', MAKER_IMPLEMENT_MAIN_TS_CHARS);
    const stylesCss = pickProjectFileContent(projectFiles, 'src/styles.css', 4000);
    const gdd = String(designBrief || '');
    const gddBody = gdd.length <= MAKER_IMPLEMENT_GDD_CHARS
        ? gdd
        : `${gdd.slice(0, MAKER_IMPLEMENT_GDD_CHARS)}\n\n/* GDD truncated for implement pass (${gdd.length} chars total). Section 3 entity architecture above is authoritative. */`;

    const is3D = String(foundation.dimension || '').toUpperCase() === '3D' || String(foundation.lane || '').toLowerCase().includes('threejs');
    
    // ── Standard canvas-kernel / single-file 3D prompt ──
    return [
        'You are the GameTok Phase 2 implement agent. Build the game incrementally — each tool call writes to the project on disk immediately.',
        '',
        'IMPLEMENT RULES:',
        ...getMakerAgentToolInstructionLines(MAKER_AGENT_TURN_MODE_IMPLEMENT),
        '- You own the full mobile layout: index.html structure, src/styles.css, and src/main.ts gameplay.',
        '- Follow foundation layoutComposition and composition law below — no fixed template shell is provided.',
        '- Use read_file / grep_project / apply_patch to build incrementally on disk.',
        '- After each edit, tsc runs automatically — read tsc errors in tool results and fix before continuing.',
        '- Kernel boot is already wired: loadDreamAssets → import main.ts. Replace stub logic only.',
        '- Keep import "./styles.css", #game-canvas at viewport 0,0, getAssetImage/firstByRole for sprites.',
        ...(!is3D ? [
            '- Canvas game: guard canvas with instanceof HTMLCanvasElement before width/height/getContext.',
        ] : []),
        '- Implement foundation requiredFunctions + probeMethods on window.__GAMETOK_TEMPLATE_PROBE__.',
        '- Use ONLY asset keys from ./assetKeys.ts (__GT_CONTRACT_ASSET_KEYS__) or ALLOWED ASSET PACK KEYS below (exact spelling).',
        '- import { __GT_CONTRACT_ASSET_KEYS__ } from "./assetKeys.ts" — do not read_file assetKeys.ts.',
        '- After src/main.ts passes tsc with the full game loop, call finish_inspection — sandbox runs next.',
        '',
        buildCompositionGuidancePromptBlock(foundation),
        '',
        buildThreeDRulesBlock(foundation),
        '',
        `Objective: ${objective || 'Implement full gameplay loop in src/main.ts.'}`,
        '',
        buildAllowedAssetKeysPromptBlock(allowedAssetKeys, assetSlotHints),
        '',
        buildUserMediaInstructionBlock(userMedia),
        '',
        'User prompt:',
        prompt,
        '',
        'Playable intent:',
        JSON.stringify({
            title: qualityIntent.title || null,
            playableExperience: qualityIntent.playableExperience || null,
            primaryMechanic: qualityIntent.primaryMechanic || qualityIntent.playerActions?.[0] || null,
            mobileControls: qualityIntent.mobileControls || [],
            mustExist: qualityIntent.mustExist || [],
            failureModesToAvoid: qualityIntent.failureModesToAvoid || [],
        }, null, 2),
        '',
        'Foundation contract (implement these):',
        JSON.stringify(summarizeFoundationForImplement(foundation), null, 2),
        '',
        'GDD (design reference):',
        gddBody,
        '',
        'Current src/main.ts scaffold (extend in place; implement layoutComposition zones yourself):',
        JSON.stringify(mainTs, null, 2),
        ...(stylesCss ? [
            '',
            'Current src/styles.css (optional tweak):',
            JSON.stringify(stylesCss, null, 2),
        ] : []),
    ].join('\n');
}

export function buildMakerAgentInspectionPrompt({
    prompt = '',
    qualityIntent = {},
    projectFiles = [],
    templateContract = null,
    assetContract = null,
    debugProtocol = null,
    designBrief = '',
    generatedAssetsSummary = null,
    assetQualitySummary = null,
    builderMaps = null,
    loopHistory = null,
    lastRunEvidence = null,
    turnNumber = 1,
    objective = '',
    transport = 'tools',
    mode = MAKER_AGENT_TURN_MODE_REPAIR,
    allowedAssetKeys = [],
    assetSlotHints = [],
    userMedia = null,
} = {}) {
    const useTools = transport === 'tools';
    const implementMode = useTools && mode === MAKER_AGENT_TURN_MODE_IMPLEMENT;
    const repairMode = useTools && !implementMode;
    const gddBody = implementMode
        ? (String(designBrief || '').length <= MAKER_IMPLEMENT_GDD_CHARS
            ? designBrief
            : truncatePromptText(designBrief, MAKER_IMPLEMENT_GDD_CHARS, 'GDD'))
        : truncatePromptText(designBrief, MAKER_REPAIR_GDD_CHARS, 'GDD');
    const _inspLane = String(templateContract?.foundation?.lane || '').toLowerCase();
    const _inspTpl = String(templateContract?.templateId || templateContract?.foundation?.foundationId || '').toLowerCase();
    const _is3DLane = _inspTpl === 'threejs-kernel' || _inspLane.includes('threejs') || _inspLane.includes('voxel')
        || _inspLane.includes('runner') || _inspLane.includes('surfer') || _inspLane.includes('dash')
        || _inspLane.includes('racer') || _inspLane.includes('racing') || _inspLane.includes('kart');

    // 3D repair context. Single-file: inline main.ts. FREE BUILD multi-file: inline
    // EVERY game source file (main.ts + game/ + entities/ + systems/ + world/ + core/)
    // so the repair agent can fix cross-file issues — e.g. an import of a module that
    // was never created (TS2307) — instead of read-looping on one file. Kernel runtime
    // files (bootstrap/threeAssets/assetLoader/assetKeys/types) are excluded.
    const _freeBuild3D = _is3DLane && repairMode && isFreeBuildMode();
    const _three3DSourceText = !(_is3DLane && repairMode)
        ? null
        : _freeBuild3D
            ? (Array.isArray(projectFiles) ? projectFiles : [])
                .filter((f) => /^src\/.*\.(ts|tsx)$/.test(String(f?.path || ''))
                    && !/^src\/(bootstrap|assetLoader|threeAssets|assetKeys)\.ts$/.test(String(f?.path || ''))
                    && !String(f?.path || '').startsWith('src/types/'))
                .map((f) => `/* ===== ${f.path} ===== */\n${String(f.content || '').slice(0, 7000)}`)
                .join('\n\n')
                .slice(0, 40000)
            : (pickProjectFileContent(projectFiles, 'src/main.ts', 16000)?.content || '(not found)');

    return [
        ...(implementMode ? [getMakerSystemManualBlock('fileAgent'), ''] : []),
        'You are the GameTok native maker file agent.',
        '',
        ...(_is3DLane ? [
            '╔══════════════════════════════════════════════════════════════════╗',
            '║  SINGLE-FILE 3D: the entire game is one file — src/main.ts      ║',
            '╚══════════════════════════════════════════════════════════════════╝',
            'state, refs, the game loop, and the probe are ALL pre-wired in src/main.ts.',
            'Fix the game-logic functions IN PLACE. Do NOT create src/scene.ts or src/mechanics.ts.',
            'NEVER add imports for state/refs — they are in the same file scope. NEVER redeclare state.',
            ...(repairMode ? [
                'The full src/main.ts is shown below — do NOT read_file it again. Go straight to apply_patch.',
                'If a mesh is undefined, the most likely cause is an unimplemented TODO function (setupScene must set refs.player; createObstacle must return a mesh).',
            ] : []),
            '',
        ] : []),
        ...(implementMode ? [
            'IMPLEMENT PASS: Replace the foundation stub in src/main.ts with the full playable game loop in ONE write_file call.',
            'Design mobile layout yourself in index.html + src/styles.css + main.ts per foundation layoutComposition — no fixed template shell.',
            buildCompositionGuidancePromptBlock(templateContract?.foundation) || '',
        ].filter(Boolean) : [
            'This is a repair pass after build/preflight/sandbox evidence. Make the smallest edits that fix the reported failures.',
            'Use read_file once per path, then apply_patch or write_file. Do not re-read the same file repeatedly without editing it.',
            'You MUST apply at least one write_file/apply_patch edit before finish_inspection. Reading alone is not a repair.',
            'If preflight says required asset slots are unreferenced: add getAssetImage(key) calls using ALLOWED ASSET PACK KEYS and draw generated backgrounds in renderAll.',
            'If preflight lists unknown keys like prop1/item1: replace them with exact keys from ALLOWED ASSET PACK KEYS or remove the reference.',
            'Focus on targetedRepairTasks and failed checks below — ignore unrelated contract noise.',
        ]),
        ...(useTools ? [
            'Use the provided NVIDIA tools to edit files. Do not dump a JSON protocol blob in plain message text.',
            '',
            'Tool rules:',
            ...getMakerAgentToolInstructionLines(mode),
        ] : [
            'Return one strict JSON object only. No markdown formatting blocks (```). No commentary.',
            '',
            'Use patch-based protocolVersion 2 responses. Patch the existing scaffold in small steps; do not rewrite entire files unless absolutely required.',
            '',
            'Protocol schema:',
            JSON.stringify(getMakerFileJsonSchemaExample(), null, 2),
            '',
            'Rules:',
            ...getMakerFileJsonEncodingRuleLines(),
        ]),
        '- CRITICAL ARCHITECTURE RULE (OPENGAME PROTOCOL): NEVER use `Phaser.GameObjects.Graphics` (or raw canvas `ctx.arc()`) to render active gameplay entities (players, enemies, projectiles).',
        '- You MUST use Sprites and Arcade Physics bodies (`this.physics.add.sprite`) for all physical gameplay objects.',
        '- If you absolutely must use Graphics for UI, background, or drawing, you MUST call `graphics.clear()` at the beginning of every `update()` loop frame to prevent ghosting and trails. Failure to do this will result in immediate rejection.',
        ...(implementMode ? [
            '- IMPLEMENT: write the complete src/main.ts in one write_file call, then finish_inspection.',
            '- Preserve kernel boot shape: import "./styles.css", #game-canvas, resizeCanvas, getAssetImage helpers unless foundation requires otherwise.',
        ] : [
            '- REPAIR: preserve the selected scaffold and existing project shape.',
            '- Use patches[].replacements with find text copied exactly from Project files.',
        ]),
        '- Edit only index.html or existing/new src/**/*.css, src/**/*.ts, src/**/*.js, src/**/*.json files.',
        '- Protected scaffold/runtime files are read-only: src/bootstrap.ts, src/assetLoader.ts, src/types/global.d.ts, src/scenes/Preloader.ts, Base*.ts files, package.json, tsconfig.json, and vite.config.ts.',
        '- For canvas-kernel dynamic foundations, implement the Foundation contract requiredFunctions and probeMethods in src/main.ts. The kernel already boots assets and draws a first-frame stub — replace stubs with the real loop.',
        '- For canvas-kernel, keep import "./styles.css" in src/main.ts and keep #game-canvas full-bleed at viewport 0,0. After getElementById("game-canvas"), narrow with instanceof HTMLCanvasElement before width/height/getContext calls (avoids TS18047 repair failures).',
        '- OpenGame asset protocol: read/use public/assets/asset-pack.json keys by construction. For Phaser projects, pass texture keys to this.add.image/sprite or this.physics.add.sprite; do not pass manifest objects or data URLs.',
        '- For canvas projects, ctx.drawImage may receive only HTMLImageElement/ImageBitmap/Canvas-like objects. Never pass DreamAssets.getImage(), DREAM_ASSET_PACK entries, asset-pack records, or raw data URL strings to drawImage.',
        ...(implementMode ? [] : [
            '- Do not rewrite entire src/main.ts unless the file is corrupt or evidence requires it.',
        ]),
        '- Do not append duplicate implementations of an existing function or class method. Modify the existing function in place; TypeScript TS2393 is a hard failure.',
        '- Check that the code implements the six-section GDD, especially Section 3 entity/function architecture.',
        '- Check that required template functions and window.__GAMETOK_TEMPLATE_PROBE__ methods are present.',
        '- Check builderMaps.usedAssetMap against source code. If the map claims an asset is used but the code does not use it, either wire it up or remove the false claim by writing src/builder-maps.json.',
        '- Check builderMaps.gameSystemMap against source code. Missing input/update/collision/win-loss/reset/probe systems should be repaired in code.',
        '- Check that generated asset slots are consumed through DreamAssets when available.',
        '- Do not add `declare global`, `declare const`, or `declare interface Window` declarations for DREAM_ASSETS, DREAM_ASSET_PACK, DREAM_ANIMATIONS, DREAM_TILESETS, DREAM_AUDIO_MANIFEST, or DreamAssets in gameplay files. The scaffold already owns those declarations.',
        '- If the rebuild evidence shows TS2687 identical modifier errors for DreamAssets/DREAM_ASSETS/DREAM_ASSET_PACK, remove duplicate runtime global declarations and use window.DreamAssets / window.DREAM_ASSETS / window.DREAM_ASSET_PACK.',
        '- If assetQualitySummary has fatalIssues, do not pretend the affected image is safe. Use a code fallback for that role or avoid the broken key.',
        '- If lastRunEvidence reports failed probes or sandbox crashes, repair the direct failing behavior. Do not make cosmetic changes before gameplay proof.',
        '- You may leave files unchanged only when the current source already satisfies contracts and the latest run evidence is clean or absent.',
        '- HUD, controls, meters, labels, and hitboxes must remain code-rendered.',
        '- Do not add external navigation, forms, remote pages, or new remote dependencies.',
        '',
        buildThreeDRulesBlock(templateContract?.foundation || null),
        '',
        `Turn: ${turnNumber}`,
        `Mode: ${mode}`,
        `Objective: ${objective || 'Audit generated files against maker contracts.'}`,
        '',
        buildAllowedAssetKeysPromptBlock(allowedAssetKeys, assetSlotHints),
        '',
        buildUserMediaInstructionBlock(userMedia),
        '',
        'Original user prompt:',
        prompt,
        '',
        'Quality intent:',
        JSON.stringify({
            title: qualityIntent.title || null,
            playableExperience: qualityIntent.playableExperience || null,
            mobileControls: qualityIntent.mobileControls || [],
            playerActions: qualityIntent.playerActions || [],
            entityRules: qualityIntent.entityRules || [],
            mustExist: qualityIntent.mustExist || [],
            feelRules: qualityIntent.feelRules || [],
            failureModesToAvoid: qualityIntent.failureModesToAvoid || [],
        }, null, 2),
        '',
        'GDD:',
        gddBody,
        '',
        'Template contract:',
        JSON.stringify(repairMode ? summarizeTemplateContractForRepair(templateContract) : (templateContract || null), null, 2),
        '',
        ...(templateContract?.foundation && !repairMode ? [
            'Foundation contract (AI architect — this job custom rules):',
            JSON.stringify(templateContract.foundation, null, 2),
            '',
        ] : []),
        'Asset contract:',
        JSON.stringify(repairMode ? summarizeAssetContractForRepair(assetContract) : (assetContract || null), null, 2),
        '',
        ...(repairMode ? [] : [
            'Debug protocol:',
            JSON.stringify(debugProtocol || null, null, 2),
            '',
            'Generated asset summary:',
            JSON.stringify(generatedAssetsSummary || null, null, 2),
            '',
            'Asset quality summary:',
            JSON.stringify(assetQualitySummary || null, null, 2),
            '',
            'Builder tool-use/system maps:',
            JSON.stringify(builderMaps || null, null, 2),
            '',
        ]),
        'Previous file-agent turns:',
        JSON.stringify(repairMode ? summarizeLoopHistoryForRepair(loopHistory) : (loopHistory || null), null, 2),
        '',
        'Last rebuild/sandbox run evidence:',
        JSON.stringify(repairMode ? summarizeEvidenceForRepairPrompt(lastRunEvidence) : (lastRunEvidence || null), null, 2),
        '',
        repairMode
            ? 'Project files (paths only — use read_file/grep_project before editing):'
            : 'Project files:',
        JSON.stringify(
            repairMode
                ? summarizeMakerProjectFiles(projectFiles)
                : summarizeProjectFilesForPrompt(projectFiles),
            null,
            2,
        ),
        // 3D repair: inline the source so the agent skips read_file. Free-build inlines
        // ALL modules; single-file inlines main.ts. If a module is imported but missing
        // (TS2307), CREATE it (write_file) — don't read-loop.
        ...(_is3DLane && repairMode ? [
            '',
            _freeBuild3D
                ? '── CURRENT GAME SOURCE (all modules below). Fix the reported build errors directly. If a file imports a module that does not exist here, CREATE that module with write_file. Do not read_file in a loop. ──'
                : '── CURRENT src/main.ts (the entire game — fix the TODO/broken functions in place via apply_patch) ──',
            _three3DSourceText || '(not found)',
        ] : []),
    ].join('\n');
}

export function parseMakerAgentInspectionResponse(text) {
    const parsed = JSON.parse(extractJson(stripMarkdownFences(text)));
    return normalizeMakerProtocolResponse(parsed);
}
