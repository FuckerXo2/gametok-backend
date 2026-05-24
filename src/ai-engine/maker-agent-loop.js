import fs from 'fs';
import path from 'path';

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
} = {}) {
    return [
        'You are the GameTok native maker file agent.',
        '',
        'This is a multi-turn file inspection pass after the first project build and before sandbox verification.',
        'Read the actual project files, compare them to the builder maps, contracts, and last run evidence, then make targeted file edits.',
        'Return XML tags only. No markdown formatting blocks (```). No commentary.',
        '',
        'XML schema:',
        '<notes>Explain what you changed and why</notes>',
        '<file path="src/main.ts">',
        '// complete replacement file content',
        '</file>',
        'If no edits are needed, return: <no-edits-needed />',
        '',
        'Rules:',
        '- CRITICAL ARCHITECTURE RULE (OPENGAME PROTOCOL): NEVER use `Phaser.GameObjects.Graphics` (or raw canvas `ctx.arc()`) to render active gameplay entities (players, enemies, projectiles).',
        '- You MUST use Sprites and Arcade Physics bodies (`this.physics.add.sprite`) for all physical gameplay objects.',
        '- If you absolutely must use Graphics for UI, background, or drawing, you MUST call `graphics.clear()` at the beginning of every `update()` loop frame to prevent ghosting and trails. Failure to do this will result in immediate rejection.',
        '- This is not a rewrite pass. Preserve the selected scaffold and existing project shape.',
        '- Edit only index.html or existing/new src/**/*.css, src/**/*.ts, src/**/*.js, src/**/*.json files.',
        '- Protected scaffold/runtime files are read-only: src/bootstrap.ts, src/assetLoader.ts, src/types/global.d.ts, src/scenes/Preloader.ts, Base*.ts files, package.json, tsconfig.json, and vite.config.ts.',
        '- OpenGame asset protocol: read/use public/assets/asset-pack.json keys by construction. For Phaser projects, pass texture keys to this.add.image/sprite or this.physics.add.sprite; do not pass manifest objects or data URLs.',
        '- For canvas projects, ctx.drawImage may receive only HTMLImageElement/ImageBitmap/Canvas-like objects. Never pass DreamAssets.getImage(), DREAM_ASSET_PACK entries, asset-pack records, or raw data URL strings to drawImage.',
        '- Return complete contents for any file you edit.',
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
        `Turn: ${turnNumber}`,
        `Objective: ${objective || 'Audit generated files against maker contracts.'}`,
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
        designBrief,
        '',
        'Template contract:',
        JSON.stringify(templateContract || null, null, 2),
        '',
        'Asset contract:',
        JSON.stringify(assetContract || null, null, 2),
        '',
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
        'Previous file-agent turns:',
        JSON.stringify(loopHistory || null, null, 2),
        '',
        'Last rebuild/sandbox run evidence:',
        JSON.stringify(lastRunEvidence || null, null, 2),
        '',
        'Project files:',
        JSON.stringify(projectFiles, null, 2),
    ].join('\n');
}

export function parseMakerAgentInspectionResponse(text) {
    // Try XML parsing first (new format)
    const files = [];
    const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g;
    let match;
    while ((match = fileRegex.exec(text)) !== null) {
        files.push({ path: match[1], content: match[2].trim() });
    }
    const notesRegex = /<notes>([\s\S]*?)<\/notes>/;
    const notesMatch = notesRegex.exec(text);
    const notes = notesMatch ? [notesMatch[1].trim()] : [];
    const noEditsNeeded = /<no-edits-needed\s*\/>/.test(text) || files.length === 0;

    // Fallback to JSON if no XML tags found (backward compat with in-flight jobs)
    if (files.length === 0 && !noEditsNeeded) {
        try {
            const parsed = JSON.parse(extractJson(stripMarkdownFences(text)));
            const jsonFiles = Array.isArray(parsed?.files)
                ? parsed.files.filter((file) => file && typeof file.path === 'string' && typeof file.content === 'string')
                : [];
            return {
                files: jsonFiles.map((file) => ({ path: file.path, content: file.content })),
                notes: Array.isArray(parsed?.notes) ? parsed.notes.map(String).slice(0, 12) : [],
                noEditsNeeded: Boolean(parsed?.noEditsNeeded) || jsonFiles.length === 0,
            };
        } catch { /* ignore JSON fallback failure */ }
    }

    return { files, notes, noEditsNeeded };
}
