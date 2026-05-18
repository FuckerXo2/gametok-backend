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
    turnNumber = 1,
} = {}) {
    return [
        'You are the GameTok native maker file agent.',
        '',
        'This is a multi-turn file inspection pass after the first project build and before sandbox verification.',
        'Read the actual project files, then make small file edits only if they materially improve GDD/template/asset compliance.',
        'Return JSON only. No markdown. No commentary.',
        '',
        'JSON schema:',
        '{',
        '  "files": [',
        '    {"path":"src/game.js","content":"complete replacement file content"}',
        '  ],',
        '  "notes": ["short note"],',
        '  "noEditsNeeded": false',
        '}',
        '',
        'Rules:',
        '- This is not a rewrite pass. Preserve the selected scaffold and existing project shape.',
        '- Edit only index.html or existing/new src/*.css, src/*.js, src/*.json files.',
        '- Return complete contents for any file you edit.',
        '- Check that the code implements the six-section GDD, especially Section 3 entity/function architecture.',
        '- Check that required template functions and window.__GAMETOK_TEMPLATE_PROBE__ methods are present.',
        '- Check that generated asset slots are consumed through DreamAssets when available.',
        '- HUD, controls, meters, labels, and hitboxes must remain code-rendered.',
        '- Do not add external navigation, forms, remote pages, or new remote dependencies.',
        '- If everything is already compliant, return {"files":[],"notes":["already compliant"],"noEditsNeeded":true}.',
        '',
        `Turn: ${turnNumber}`,
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
        'Project files:',
        JSON.stringify(projectFiles, null, 2),
    ].join('\n');
}

export function parseMakerAgentInspectionResponse(text) {
    const parsed = JSON.parse(extractJson(stripMarkdownFences(text)));
    const files = Array.isArray(parsed?.files)
        ? parsed.files.filter((file) => file && typeof file.path === 'string' && typeof file.content === 'string')
        : [];
    return {
        files: files.map((file) => ({ path: file.path, content: file.content })),
        notes: Array.isArray(parsed?.notes) ? parsed.notes.map(String).slice(0, 12) : [],
        noEditsNeeded: Boolean(parsed?.noEditsNeeded) || files.length === 0,
    };
}
