import fs from 'fs';
import path from 'path';

import { applyPatchReplacements } from './maker-agent-patches.js';

export const MAKER_TOOL_APPLY_PATCH = 'apply_patch';
export const MAKER_TOOL_WRITE_FILE = 'write_file';
export const MAKER_TOOL_FINISH_INSPECTION = 'finish_inspection';

export const MAKER_AGENT_TURN_MODE_IMPLEMENT = 'implement';
export const MAKER_AGENT_TURN_MODE_REPAIR = 'repair';

const MIN_FIND_LENGTH = 12;
const MAX_WRITE_FILE_CHARS = 12000;
const MAX_WRITE_FILE_CHARS_MAIN = Math.max(
    16000,
    Math.min(128000, Number(process.env.GAMETOK_MAKER_AGENT_MAIN_TS_MAX_CHARS || 96000)),
);
const DEFAULT_MAX_ROUNDS = 16;
const DEFAULT_MAX_TOOL_CALLS = 24;
const IMPLEMENT_MAX_ROUNDS = Math.max(
    2,
    Math.min(6, Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_MAX_ROUNDS || 4)),
);
const REPAIR_MAX_ROUNDS = Math.max(
    4,
    Math.min(12, Number(process.env.GAMETOK_MAKER_AGENT_REPAIR_MAX_ROUNDS || 8)),
);
const IMPLEMENT_MAX_TOOL_CALLS = Math.max(
    2,
    Math.min(4, Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_MAX_TOOL_CALLS || 3)),
);
const REPAIR_MAX_TOOL_CALLS = Math.max(
    6,
    Math.min(16, Number(process.env.GAMETOK_MAKER_AGENT_REPAIR_MAX_TOOL_CALLS || 12)),
);

export function useMakerAgentTools() {
    return String(process.env.GAMETOK_MAKER_AGENT_TOOLS || 'true').toLowerCase() !== 'false';
}

export function useMakerAgentImplementMode() {
    return useMakerAgentTools()
        && String(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_MODE || 'true').toLowerCase() !== 'false';
}

export function resolveMakerAgentTurnMode(turnNumber = 1) {
    if (!useMakerAgentTools()) return 'json';
    if (useMakerAgentImplementMode() && turnNumber === 1) return MAKER_AGENT_TURN_MODE_IMPLEMENT;
    return MAKER_AGENT_TURN_MODE_REPAIR;
}

export function getMakerAgentToolDefinitions() {
    return [
        {
            type: 'function',
            function: {
                name: MAKER_TOOL_APPLY_PATCH,
                description: 'Apply one find/replace edit to a project file. find must match exactly once unless replace_all is true.',
                parameters: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'Project-relative path, e.g. src/main.ts or src/styles.css',
                        },
                        find: {
                            type: 'string',
                            description: 'Exact substring copied from the current file, at least 12 characters',
                        },
                        replace: {
                            type: 'string',
                            description: 'Replacement text (may include newlines)',
                        },
                        replace_all: {
                            type: 'boolean',
                            description: 'Replace every occurrence of find when true',
                        },
                        reason: {
                            type: 'string',
                            description: 'Short note about why this edit helps',
                        },
                    },
                    required: ['path', 'find', 'replace'],
                    additionalProperties: false,
                },
            },
        },
        {
            type: 'function',
            function: {
                name: MAKER_TOOL_WRITE_FILE,
                description: 'Write a project file in full. On implement turn 1, use this once for src/main.ts with the complete game loop.',
                parameters: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'Project-relative path',
                        },
                        content: {
                            type: 'string',
                            description: 'Full new file contents',
                        },
                        reason: {
                            type: 'string',
                            description: 'Short note about why this edit helps',
                        },
                    },
                    required: ['path', 'content'],
                    additionalProperties: false,
                },
            },
        },
        {
            type: 'function',
            function: {
                name: MAKER_TOOL_FINISH_INSPECTION,
                description: 'Signal that this inspection turn is complete. Call when done editing or when no changes are needed.',
                parameters: {
                    type: 'object',
                    properties: {
                        no_edits_needed: {
                            type: 'boolean',
                            description: 'True when the project already satisfies the objective',
                        },
                        notes: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Short summary notes for the turn log',
                        },
                    },
                    required: ['no_edits_needed'],
                    additionalProperties: false,
                },
            },
        },
    ];
}

export function getMakerAgentToolInstructionLines(mode = MAKER_AGENT_TURN_MODE_REPAIR) {
    if (mode === MAKER_AGENT_TURN_MODE_IMPLEMENT) {
        return [
            'IMPLEMENT MODE (turn 1): ship the game in one shot.',
            'Call write_file ONCE with the complete src/main.ts implementation (full file, not a diff).',
            'Then call finish_inspection immediately. Do NOT call apply_patch on this turn.',
            'You may optionally call write_file for src/styles.css if needed, then finish_inspection.',
            'Keep import "./styles.css", #game-canvas boot, foundation probeMethods, and requiredFunctions from the stub unless the foundation contract requires changes.',
            'Use ONLY asset keys from the ALLOWED ASSET PACK KEYS block (exact spelling).',
            'Protected read-only files: src/bootstrap.ts, src/assetLoader.ts, src/types/global.d.ts, package.json, tsconfig.json, vite.config.ts.',
        ];
    }
    return [
        'REPAIR MODE: fix the specific preflight/build/sandbox failures shown in last run evidence.',
        'Prefer apply_patch with exact find anchors copied from Project files.',
        'Call write_file only for small files (styles.css, tiny helpers). Avoid full src/main.ts rewrites unless evidence shows the file is corrupt.',
        'Call finish_inspection when done. Set no_edits_needed=true only if the project already passes the objective.',
        'Make 1-6 focused apply_patch calls per turn when changes are needed.',
        'Protected read-only files: src/bootstrap.ts, src/assetLoader.ts, src/types/global.d.ts, package.json, tsconfig.json, vite.config.ts.',
    ];
}

function parseToolArguments(raw = '{}') {
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('tool arguments must be a JSON object');
        }
        return parsed;
    } catch (error) {
        throw new Error(`Invalid tool arguments JSON: ${error.message}`);
    }
}

function normalizeMakerToolPath(filePath = '') {
    return String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function isMainTsPath(filePath = '') {
    return normalizeMakerToolPath(filePath) === 'src/main.ts';
}

async function executeApplyPatch(projectRoot, helpers, args = {}, { mode = MAKER_AGENT_TURN_MODE_REPAIR } = {}) {
    if (mode === MAKER_AGENT_TURN_MODE_IMPLEMENT) {
        throw new Error('apply_patch is disabled in implement mode — use write_file("src/main.ts", fullContent) once, then finish_inspection');
    }

    const filePath = args.path;
    const find = args.find;
    const replace = args.replace;
    const replaceAll = Boolean(args.replace_all);

    if (typeof filePath !== 'string' || !filePath.trim()) {
        throw new Error('apply_patch requires path');
    }
    if (typeof find !== 'string' || find.length < MIN_FIND_LENGTH) {
        throw new Error(`apply_patch find text must be at least ${MIN_FIND_LENGTH} characters`);
    }
    if (typeof replace !== 'string') {
        throw new Error('apply_patch requires replace string');
    }

    const { cleanPath, absolutePath } = helpers.safeMakerProjectPath(projectRoot, filePath);
    if (helpers.isProtectedMakerRuntimeFile(cleanPath)) {
        throw new Error(`apply_patch blocked on protected file: ${cleanPath}`);
    }

    const currentContent = await fs.promises.readFile(absolutePath, 'utf8');
    const patched = applyPatchReplacements(currentContent, [{
        find,
        replace,
        replaceAll,
    }], { path: cleanPath });
    const content = helpers.sanitizeMakerMainTsContent(patched.content, cleanPath);
    await fs.promises.writeFile(absolutePath, content, 'utf8');

    return {
        ok: true,
        tool: MAKER_TOOL_APPLY_PATCH,
        path: cleanPath,
        bytes: Buffer.byteLength(content, 'utf8'),
        replacements: patched.applied.length,
    };
}

async function executeWriteFile(projectRoot, helpers, args = {}, { mode = MAKER_AGENT_TURN_MODE_REPAIR } = {}) {
    const filePath = args.path;
    const content = args.content;

    if (typeof filePath !== 'string' || !filePath.trim()) {
        throw new Error('write_file requires path');
    }
    if (typeof content !== 'string') {
        throw new Error('write_file requires content string');
    }

    const cleanPath = normalizeMakerToolPath(filePath);
    const maxChars = isMainTsPath(cleanPath) ? MAX_WRITE_FILE_CHARS_MAIN : MAX_WRITE_FILE_CHARS;
    if (content.length > maxChars) {
        throw new Error(`write_file content exceeds ${maxChars} chars for ${cleanPath}`);
    }

    if (mode === MAKER_AGENT_TURN_MODE_IMPLEMENT) {
        const allowedImplementPaths = new Set(['src/main.ts', 'src/styles.css']);
        if (!allowedImplementPaths.has(cleanPath)) {
            throw new Error(`implement mode write_file allowed only for src/main.ts or src/styles.css (got ${cleanPath})`);
        }
    }

    const { cleanPath: resolvedPath, absolutePath } = helpers.safeMakerProjectPath(projectRoot, filePath);
    if (helpers.isProtectedMakerRuntimeFile(resolvedPath)) {
        throw new Error(`write_file blocked on protected file: ${resolvedPath}`);
    }

    const sanitized = helpers.sanitizeMakerMainTsContent(content, resolvedPath);
    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, sanitized, 'utf8');

    return {
        ok: true,
        tool: MAKER_TOOL_WRITE_FILE,
        path: resolvedPath,
        bytes: Buffer.byteLength(sanitized, 'utf8'),
    };
}

function executeFinishInspection(args = {}) {
    const notes = Array.isArray(args.notes)
        ? args.notes.map(String).filter(Boolean).slice(0, 12)
        : [];
    return {
        ok: true,
        tool: MAKER_TOOL_FINISH_INSPECTION,
        finished: true,
        noEditsNeeded: Boolean(args.no_edits_needed),
        notes,
    };
}

async function executeMakerToolCall(projectRoot, helpers, toolName, rawArgs, options = {}) {
    const args = parseToolArguments(rawArgs);
    switch (toolName) {
        case MAKER_TOOL_APPLY_PATCH:
            return executeApplyPatch(projectRoot, helpers, args, options);
        case MAKER_TOOL_WRITE_FILE:
            return executeWriteFile(projectRoot, helpers, args, options);
        case MAKER_TOOL_FINISH_INSPECTION:
            return executeFinishInspection(args);
        default:
            throw new Error(`Unknown maker tool: ${toolName}`);
    }
}

function summarizeEditFromToolResult(result = {}) {
    if (!result?.ok || !result.path) {
        return null;
    }
    return {
        path: result.path,
        bytes: result.bytes || 0,
        patchReplacements: result.replacements || 0,
        tool: result.tool,
    };
}

function resolveTurnLimits(mode = MAKER_AGENT_TURN_MODE_REPAIR) {
    if (mode === MAKER_AGENT_TURN_MODE_IMPLEMENT) {
        return {
            maxRounds: IMPLEMENT_MAX_ROUNDS,
            maxToolCalls: IMPLEMENT_MAX_TOOL_CALLS,
        };
    }
    return {
        maxRounds: REPAIR_MAX_ROUNDS,
        maxToolCalls: REPAIR_MAX_TOOL_CALLS,
    };
}

/**
 * Multi-turn NVIDIA tool session for one file-agent inspection turn.
 * Applies edits immediately so follow-up tool calls see updated files.
 */
export async function runMakerAgentToolTurn({
    userPrompt,
    projectRoot,
    requestCompletion,
    helpers,
    mode = MAKER_AGENT_TURN_MODE_REPAIR,
    maxRounds,
    maxToolCalls,
} = {}) {
    if (!projectRoot || !helpers?.safeMakerProjectPath || !helpers?.isProtectedMakerRuntimeFile || !helpers?.sanitizeMakerMainTsContent) {
        throw new Error('runMakerAgentToolTurn requires projectRoot and path/sanitize helpers');
    }
    if (typeof requestCompletion !== 'function') {
        throw new Error('runMakerAgentToolTurn requires requestCompletion(messages)');
    }

    const limits = resolveTurnLimits(mode);
    const effectiveMaxRounds = maxRounds ?? limits.maxRounds;
    const effectiveMaxToolCalls = maxToolCalls ?? limits.maxToolCalls;

    const messages = [{ role: 'user', content: String(userPrompt || '') }];
    const log = {
        transport: 'nvidia_tools',
        mode,
        rounds: 0,
        toolCalls: 0,
        events: [],
    };
    const editsApplied = [];
    let noEditsNeeded = false;
    let notes = [];
    let finished = false;
    let wroteMainTs = false;

    for (let round = 0; round < effectiveMaxRounds && !finished; round += 1) {
        log.rounds = round + 1;
        const message = await requestCompletion(messages);
        const assistantEntry = {
            role: 'assistant',
            content: message?.content || null,
        };
        if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
            assistantEntry.tool_calls = message.tool_calls;
        }
        messages.push(assistantEntry);

        const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
        if (toolCalls.length === 0) {
            if (String(message?.content || '').trim()) {
                log.events.push({ round: round + 1, type: 'assistant_text', preview: String(message.content).slice(0, 240) });
            }
            if (mode === MAKER_AGENT_TURN_MODE_IMPLEMENT) {
                messages.push({
                    role: 'user',
                    content: 'Implement mode: call write_file for src/main.ts with the FULL game implementation, then call finish_inspection. Do not reply with plain text or JSON.',
                });
            } else if (round >= effectiveMaxRounds - 1) {
                break;
            } else {
                messages.push({
                    role: 'user',
                    content: 'Continue using apply_patch / write_file tools, then call finish_inspection when done.',
                });
            }
            continue;
        }

        for (const toolCall of toolCalls) {
            if (log.toolCalls >= effectiveMaxToolCalls) {
                throw new Error(`Maker tool turn exceeded max tool calls (${effectiveMaxToolCalls}) in ${mode} mode`);
            }
            log.toolCalls += 1;

            const toolName = toolCall?.function?.name;
            const toolCallId = toolCall?.id || `call_${log.toolCalls}`;
            let result;
            try {
                result = await executeMakerToolCall(
                    projectRoot,
                    helpers,
                    toolName,
                    toolCall?.function?.arguments || '{}',
                    { mode },
                );
            } catch (error) {
                result = {
                    ok: false,
                    tool: toolName,
                    error: error.message || String(error),
                };
            }

            log.events.push({
                round: round + 1,
                tool: toolName,
                ok: result.ok !== false,
                path: result.path || null,
                error: result.error || null,
            });

            messages.push({
                role: 'tool',
                tool_call_id: toolCallId,
                content: JSON.stringify(result),
            });

            const editSummary = summarizeEditFromToolResult(result);
            if (editSummary) {
                editsApplied.push(editSummary);
                noEditsNeeded = false;
                if (editSummary.path === 'src/main.ts' && editSummary.tool === MAKER_TOOL_WRITE_FILE) {
                    wroteMainTs = true;
                }
            }

            if (toolName === MAKER_TOOL_FINISH_INSPECTION && result.finished) {
                finished = true;
                noEditsNeeded = Boolean(result.noEditsNeeded) && editsApplied.length === 0;
                notes = Array.isArray(result.notes) ? result.notes : [];
            }
        }
    }

    if (!finished && mode === MAKER_AGENT_TURN_MODE_IMPLEMENT && wroteMainTs) {
        finished = true;
        notes = ['Auto-finished implement turn after successful src/main.ts write_file.'];
    }

    if (!finished) {
        noEditsNeeded = editsApplied.length === 0;
        notes = editsApplied.length > 0
            ? [`Tool session ended without finish_inspection; edits were applied (${mode} mode).`]
            : [`Tool session ended without edits (${mode} mode).`];
    }

    if (mode === MAKER_AGENT_TURN_MODE_IMPLEMENT && !wroteMainTs && editsApplied.length === 0) {
        throw new Error('Implement mode requires write_file("src/main.ts", ...) with the full game loop');
    }

    return {
        noEditsNeeded,
        notes,
        editsApplied,
        log,
        messageCount: messages.length,
        mode,
        wroteMainTs,
    };
}
