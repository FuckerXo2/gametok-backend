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
        '3D RULES (threejs-kernel — these override any 2D canvas guidance):',
        "- DO NOT read_file src/threeAssets.ts or src/bootstrap.ts — they are read-only kernel files and reading them wastes your turn. Their full API is given here: createThreeStage(canvas) → { renderer, scene, camera, resize } and is ALREADY called at the top of main.ts (renderer/scene/camera are in scope). It already sets a sky-blue background, fog, a hemisphere + directional light, and handles resize. buildVoxelField(cells) builds one InstancedMesh for blocky worlds. You do NOT need any other import from threeAssets.",
        "- import * as THREE from 'three'. Everything else you need is already imported and wired in main.ts.",
        '- The stub already calls createThreeStage(): it owns renderer, camera, lights, sky color, fog, and resize. EXTEND the returned scene/camera — never create a second renderer, never remove the hemisphere+directional lights (a lightless scene renders pitch black).',
        "- THIS IS WEBGL, NOT 2D CANVAS. There is NO `ctx` and NO getContext('2d'). NEVER write ctx, ctx.drawImage, ctx.fillRect, ctx.clearRect, or any 2D canvas drawing — that variable does not exist and will fail tsc. ALL world visuals are Three.js objects (Mesh/Sprite/InstancedMesh) added to the scene; the only draw call is renderer.render(scene, camera). HUD text is DOM in #hud, never canvas.",
        `- Camera rig: ${cameraRig}. Implement smooth follow/look in stepGame — never teleport the camera every frame without damping.`,
        '- Geometry is CODE-BUILT: BoxGeometry, PlaneGeometry, CylinderGeometry, and buildVoxelField for blocky/Minecraft-style worlds (ONE InstancedMesh = one draw call — never one Mesh per block, never more than ~5000 instanced cells).',
        "- FLAT COLORS ONLY (Crossy Road style): there are NO image textures in a GameTok 3D game. Color every surface with MeshLambertMaterial({ color: '#rrggbb' }) using the foundation palette. NEVER call getDreamTexture/getTileTexture/makeBillboard/applySkybox, never set material.map, never read window.DREAM_ASSET_PACK/DREAM_IMAGES for visuals. The sky is already set by createThreeStage.",
        '- Distinguish player, obstacles, coins, lanes, and pickups by COLOR + SHAPE + size. For voxel/blocky worlds, give each cell a color via buildVoxelField (setColorAt). A clean small palette reads as premium — never leave geometry untinted default-white.',
        '- PERF BUDGET (phone webview): MeshLambertMaterial/MeshBasicMaterial only (no Standard/Physical), no shadow maps, no postprocessing, total triangles under 150k, reuse geometries/materials, never allocate new objects inside the render loop.',
        '- Collisions: simple math — AABB boxes, sphere distance checks, or grid-cell lookups for voxel worlds. No physics engine.',
        '- Controls (both always active): touch = left-half drag or virtual joystick to move, right-half drag to look/steer, on-screen buttons for actions; keyboard = WASD/arrows to move, Space/Enter primary action. Hide on-screen buttons on desktop via @media (pointer: coarse).',
        '- Keep window.__GAMETOK_TEMPLATE_PROBE__ working: snapshot must keep reporting renderCalls/triangles from renderer.info plus the game state — the sandbox uses renderCalls > 0 as render proof.',
        '- DOM HUD (#hud) on top of the canvas for score/meters per the uiKit — never render text with Three.js geometry.',
        ...(lane.includes('runner') || lane.includes('surfer') || lane.includes('dash') ? [
            '- RUNNER (SINGLE FILE, ALREADY PLAYABLE): src/main.ts already runs as a working snowboard/runner game — state, refs, loop, probe, AND the five functions (setupScene, createObstacle, movePlayer, checkCollisions, updateCamera) are all implemented with a generic blue-box rider + green pine trees. Your job is to ENHANCE the visuals to match THIS game\'s theme: rebuild the player Group inside setupScene with a themed shape/colors, rebuild the obstacle inside createObstacle, retune colors/fog. RULES: keep each function\'s exact name and parameters (setupScene(scene, camera), createObstacle(scene, playerZ), movePlayer(state, dt), checkCollisions(state), updateCamera(camera, state)); setupScene MUST still set refs.player and add a ground; createObstacle MUST still return a mesh added to the scene. NEVER add imports, NEVER rename functions or change parameters. REGION CONTRACT: edit ONLY the code between the `// ===== GAMETOK:EDIT START =====` and `// ===== GAMETOK:EDIT END =====` markers (the five functions). Everything between `// ===== GAMETOK:SACRED START =====` and `// ===== GAMETOK:SACRED END =====` (state, input, game loop, render, reset, probe) must come back BYTE-FOR-BYTE UNCHANGED — never redeclare state, never invent a new obstacle store (the canonical array is state.obstacles), never touch the loop/input/probe, and keep the SACRED markers in place. You may still write the whole file in one write_file call, but the SACRED blocks must be reproduced verbatim. Flat colors only (MeshLambertMaterial hex). No getDreamTexture.',
        ] : []),
        ...(lane.includes('racer') || lane.includes('racing') || lane.includes('kart') ? [
            '- RACER (SINGLE FILE): everything lives in src/main.ts — state, loop, and probe are PRE-WIRED. Enhance the game-logic functions in place (buildTrack, spawnRivals, steerCar, checkLapProgress) to theme the visuals, keeping their names + parameters. They share scope with state/scene/camera — NEVER add imports, NEVER redeclare state, NEVER split into other files. Keep the pre-wired loop/probe exactly. Flat colors only.',
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
        '- Canvas game: guard canvas with instanceof HTMLCanvasElement before width/height/getContext.',
        '- Implement foundation requiredFunctions + probeMethods on window.__GAMETOK_TEMPLATE_PROBE__.',
        '- HUD, buttons, timers, order bubbles: code-rendered only (canvas/DOM). No Phaser for canvas-kernel.',
        '- Design the HUD per foundation hudDesign (empty #hud mount), only the stats the game needs, themed to the uiKit. CRITICAL for action/arcade/runner/racer/shooter/score-chase games: render a CLEAN INTEGRATED overlay — big bold glowing/outlined numbers in the corners, lives as a row of icons/hearts/pips, thin meter bars. Do NOT wrap each stat in a bordered chip/box/panel, and NEVER place three identical bordered stat boxes in a row (that looks like generic dev UI). Bare themed text on the scene reads as premium arcade UI. Only content-heavy casual games (cooking/puzzle/builder) ground stats on uiKit panels for contrast.',
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

    // Single-file 3D repair: inline the whole main.ts so the agent has full context
    // without calling read_file in a loop. Everything lives in this one file.
    const _three3DMainTs = _is3DLane && repairMode
        ? pickProjectFileContent(projectFiles, 'src/main.ts', 16000)
        : null;

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
        // Single-file 3D repair: inline the whole main.ts so the agent skips read_file entirely.
        ...(_is3DLane && repairMode ? [
            '',
            '── CURRENT src/main.ts (the entire game — fix the TODO/broken functions in place via apply_patch) ──',
            _three3DMainTs ? _three3DMainTs.content : '(not found)',
        ] : []),
    ].join('\n');
}

export function parseMakerAgentInspectionResponse(text) {
    const parsed = JSON.parse(extractJson(stripMarkdownFences(text)));
    return normalizeMakerProtocolResponse(parsed);
}
