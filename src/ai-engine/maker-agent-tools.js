import fs from 'fs';
import path from 'path';

import { applyPatchReplacements } from './maker-agent-patches.js';
import { resolveMakerAgentImplementTurns, resolveMakerAgentInspectionTurns } from './maker-factory-mode.js';
import { parseTscOutput } from './maker-project-compile-gate.js';

export const MAKER_TOOL_APPLY_PATCH = 'apply_patch';
export const MAKER_TOOL_WRITE_FILE = 'write_file';
export const MAKER_TOOL_READ_FILE = 'read_file';
export const MAKER_TOOL_GREP_PROJECT = 'grep_project';
export const MAKER_TOOL_RUN_TSC = 'run_tsc_check';
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
    4,
    Math.min(16, Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_MAX_ROUNDS || 10)),
);
const REPAIR_MAX_ROUNDS = Math.max(
    4,
    Math.min(12, Number(process.env.GAMETOK_MAKER_AGENT_REPAIR_MAX_ROUNDS || 8)),
);
const IMPLEMENT_MAX_TOOL_CALLS = Math.max(
    6,
    Math.min(48, Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_MAX_TOOL_CALLS || 32)),
);
const IMPLEMENT_MAX_TOOL_CALLS_CEILING = Math.max(
    IMPLEMENT_MAX_TOOL_CALLS,
    Math.min(64, Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_MAX_TOOL_CALLS_CEILING || 48)),
);
const IMPLEMENT_ASSET_KEY_BONUS_THRESHOLD = Math.max(
    24,
    Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_ASSET_BONUS_THRESHOLD || 40),
);
const IMPLEMENT_ASSET_KEY_BONUS_STEP = Math.max(
    4,
    Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_ASSET_BONUS_STEP || 5),
);
const IMPLEMENT_EDIT_PATHS = new Set(['src/main.ts', 'src/styles.css']);
const IMPLEMENT_FILE_SNAPSHOT_CHARS = Math.max(
    2000,
    Math.min(12000, Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_SNAPSHOT_CHARS || 6000)),
);
const REPAIR_MAX_TOOL_CALLS = Math.max(
    18,
    Math.min(40, Number(process.env.GAMETOK_MAKER_AGENT_REPAIR_MAX_TOOL_CALLS || 28)),
);
const REPAIR_MAX_READ_ONLY_ROUNDS = Math.max(
    1,
    Math.min(4, Number(process.env.GAMETOK_MAKER_AGENT_REPAIR_MAX_READ_ONLY_ROUNDS || 2)),
);
const IMPLEMENT_MAX_READ_ONLY_ROUNDS = Math.max(
    1,
    Math.min(4, Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_MAX_READ_ONLY_ROUNDS || 2)),
);
const IMPLEMENT_MAIN_TS_AUTO_FINISH_MIN_BYTES = Math.max(
    8000,
    Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_MAIN_TS_AUTO_FINISH_MIN_BYTES || 12000),
);
const IMPLEMENT_STUB_MAX_BYTES = Math.max(
    4000,
    Number(process.env.GAMETOK_MAKER_STUB_MAX_BYTES || 12000),
);
const READ_FILE_MAX_CHARS = Math.max(
    2000,
    Math.min(24000, Number(process.env.GAMETOK_MAKER_AGENT_READ_FILE_MAX_CHARS || 12000)),
);
const MAKER_AGENT_MAX_PROMPT_CHARS = Math.max(
    16000,
    Math.min(64000, Number(process.env.GAMETOK_MAKER_AGENT_MAX_PROMPT_CHARS || 28000)),
);
const READ_FILE_HISTORY_PREVIEW_CHARS = Math.max(
    400,
    Math.min(4000, Number(process.env.GAMETOK_MAKER_AGENT_READ_FILE_HISTORY_PREVIEW || 1200)),
);
const GREP_MAX_MATCHES = Math.max(8, Math.min(80, Number(process.env.GAMETOK_MAKER_AGENT_GREP_MAX_MATCHES || 40)));
const TSC_AFTER_EACH_EDIT = String(process.env.GAMETOK_MAKER_TSC_AFTER_EACH_EDIT || 'true').toLowerCase() !== 'false';
const AGENT_READABLE_ROOTS = ['src/', 'public/'];

export function useMakerAgentTools() {
    return String(process.env.GAMETOK_MAKER_AGENT_TOOLS || 'true').toLowerCase() !== 'false';
}

export function useMakerAgentImplementMode() {
    return useMakerAgentTools()
        && String(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_MODE || 'true').toLowerCase() !== 'false';
}

export function resolveMakerAgentTurnMode(turnNumber = 1, { maxTurns = null } = {}) {
    if (!useMakerAgentTools()) return 'json';
    if (!useMakerAgentImplementMode()) return MAKER_AGENT_TURN_MODE_REPAIR;
    const totalTurns = Math.max(2, Math.min(4, Number(maxTurns || resolveMakerAgentInspectionTurns())));
    const implementTurns = resolveMakerAgentImplementTurns(totalTurns);
    if (turnNumber <= implementTurns) return MAKER_AGENT_TURN_MODE_IMPLEMENT;
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
                description: 'Write a project file in full. Prefer apply_patch for incremental implement edits; use write_file for small files or a full src/main.ts rewrite when simpler.',
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
                name: MAKER_TOOL_READ_FILE,
                description: 'Read a project file from disk. Use before apply_patch to copy exact find anchors.',
                parameters: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'Project-relative path under src/ or public/, e.g. src/main.ts',
                        },
                        max_chars: {
                            type: 'number',
                            description: 'Optional max chars to return (default 32000)',
                        },
                    },
                    required: ['path'],
                    additionalProperties: false,
                },
            },
        },
        {
            type: 'function',
            function: {
                name: MAKER_TOOL_GREP_PROJECT,
                description: 'Search project source files for a string or regex pattern.',
                parameters: {
                    type: 'object',
                    properties: {
                        pattern: {
                            type: 'string',
                            description: 'Text or regex pattern to search for',
                        },
                        path_prefix: {
                            type: 'string',
                            description: 'Optional path prefix filter, e.g. src/main.ts or src/',
                        },
                        case_sensitive: {
                            type: 'boolean',
                            description: 'Case sensitive search when true',
                        },
                    },
                    required: ['pattern'],
                    additionalProperties: false,
                },
            },
        },
        {
            type: 'function',
            function: {
                name: MAKER_TOOL_RUN_TSC,
                description: 'Run TypeScript compile check (tsc --noEmit) on the project and return errors.',
                parameters: {
                    type: 'object',
                    properties: {
                        reason: {
                            type: 'string',
                            description: 'Why you are running tsc now',
                        },
                    },
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
            'IMPLEMENT MODE: build the game incrementally like a coding agent — each edit tool writes to disk immediately.',
            'Use read_file / grep_project to inspect the live project before patching.',
            'Prefer apply_patch on src/main.ts: wire lane movement, traffic, fuel/distance HUD, rendering, and probe behavior.',
            'Extend the foundation stub in place — do not duplicate state keys or DOM ids.',
            'After each edit, tsc runs automatically — fix any TypeScript errors before continuing.',
            'You may call run_tsc_check manually after a batch of edits.',
            'Make 4-12 focused apply_patch edits across rounds.',
            'write_file is allowed for src/main.ts or src/styles.css when a full rewrite is simpler.',
            'Call finish_inspection when the loop is complete. Do not dump plain text or JSON blobs.',
            'Keep import "./styles.css", #game-canvas boot, foundation requiredFunctions, and probeMethods.',
            'Use ONLY asset keys from ./assetKeys.ts (__GT_CONTRACT_ASSET_KEYS__) or the ALLOWED ASSET PACK KEYS block — exact spelling.',
            'After src/main.ts is fully implemented and tsc is clean, call finish_inspection immediately — do not keep re-reading files.',
            'Protected read-only files: src/bootstrap.ts, src/assetLoader.ts, src/assetKeys.ts, src/types/global.d.ts, package.json, tsconfig.json, vite.config.ts.',
        ];
    }
    return [
        'REPAIR MODE: fix the specific preflight/build/sandbox failures shown in last run evidence.',
        'You MUST call apply_patch or write_file on src/main.ts within the first 2 tool rounds — do not read the same file repeatedly.',
        'Use read_file once to copy exact find anchors, then patch immediately.',
        'Prefer apply_patch with exact find anchors copied from read_file output.',
        'write_file on src/main.ts is allowed when compile errors or duplicate state keys require a structural fix.',
        'run_tsc_check runs automatically after edits; fix all TS errors before finish_inspection.',
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

function isAgentReadablePath(cleanPath = '') {
    const normalized = normalizeMakerToolPath(cleanPath);
    return AGENT_READABLE_ROOTS.some((prefix) => normalized.startsWith(prefix));
}

async function walkSearchFiles(projectRoot, relativeDir, matches = []) {
    const absoluteDir = path.join(projectRoot, relativeDir);
    let entries = [];
    try {
        entries = await fs.promises.readdir(absoluteDir, { withFileTypes: true });
    } catch {
        return matches;
    }
    for (const entry of entries) {
        const relPath = path.join(relativeDir, entry.name).replace(/\\/g, '/');
        if (entry.isDirectory()) {
            await walkSearchFiles(projectRoot, relPath, matches);
            continue;
        }
        if (!/\.(ts|tsx|js|jsx|css|json|html)$/i.test(entry.name)) continue;
        matches.push(relPath);
    }
    return matches;
}

async function executeReadFile(projectRoot, helpers, args = {}) {
    const filePath = args.path;
    if (typeof filePath !== 'string' || !filePath.trim()) {
        throw new Error('read_file requires path');
    }
    const cleanPath = normalizeMakerToolPath(filePath);
    if (!isAgentReadablePath(cleanPath)) {
        throw new Error(`read_file allowed only under src/ or public/ (got ${cleanPath})`);
    }
    const { cleanPath: resolvedPath, absolutePath } = helpers.safeMakerProjectPath(projectRoot, filePath);
    if (helpers.isProtectedMakerRuntimeFile(resolvedPath)) {
        throw new Error(`read_file blocked on protected file: ${resolvedPath}`);
    }
    const content = await fs.promises.readFile(absolutePath, 'utf8');
    const maxChars = Math.min(
        READ_FILE_MAX_CHARS,
        Math.max(1000, Number(args.max_chars || READ_FILE_MAX_CHARS)),
    );
    const truncated = content.length > maxChars;
    return {
        ok: true,
        tool: MAKER_TOOL_READ_FILE,
        path: resolvedPath,
        bytes: Buffer.byteLength(content, 'utf8'),
        truncated,
        content: truncated
            ? `${content.slice(0, maxChars)}\n/* ... truncated (${content.length} chars total) */`
            : content,
    };
}

async function executeGrepProject(projectRoot, helpers, args = {}) {
    const pattern = args.pattern;
    if (typeof pattern !== 'string' || !pattern.trim()) {
        throw new Error('grep_project requires pattern');
    }
    const pathPrefix = normalizeMakerToolPath(args.path_prefix || 'src/');
    const caseSensitive = Boolean(args.case_sensitive);
    let regex;
    try {
        regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
    } catch {
        regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
    }

    const files = [];
    if (pathPrefix.endsWith('.ts') || pathPrefix.endsWith('.js') || pathPrefix.endsWith('.css')) {
        files.push(pathPrefix);
    } else {
        const roots = pathPrefix.startsWith('public/') ? ['public'] : ['src', 'public'];
        for (const root of roots) {
            await walkSearchFiles(projectRoot, root, files);
        }
    }

    const matches = [];
    for (const relPath of files) {
        if (pathPrefix && !relPath.startsWith(pathPrefix)) continue;
        const { absolutePath, cleanPath } = helpers.safeMakerProjectPath(projectRoot, relPath);
        if (helpers.isProtectedMakerRuntimeFile(cleanPath)) continue;
        let content = '';
        try {
            content = await fs.promises.readFile(absolutePath, 'utf8');
        } catch {
            continue;
        }
        const lines = content.split('\n');
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            if (!regex.test(lines[lineIndex])) {
                regex.lastIndex = 0;
                continue;
            }
            regex.lastIndex = 0;
            matches.push({
                path: cleanPath,
                line: lineIndex + 1,
                text: lines[lineIndex].trim().slice(0, 240),
            });
            if (matches.length >= GREP_MAX_MATCHES) break;
        }
        if (matches.length >= GREP_MAX_MATCHES) break;
    }

    return {
        ok: true,
        tool: MAKER_TOOL_GREP_PROJECT,
        pattern,
        matchCount: matches.length,
        truncated: matches.length >= GREP_MAX_MATCHES,
        matches,
    };
}

async function executeRunTsc(projectRoot, helpers) {
    if (typeof helpers.runTscCheck !== 'function') {
        throw new Error('run_tsc_check is unavailable in this session');
    }
    try {
        await helpers.runTscCheck(projectRoot);
        return {
            ok: true,
            tool: MAKER_TOOL_RUN_TSC,
            tsc: { ok: true, errors: [] },
        };
    } catch (error) {
        return {
            ok: true,
            tool: MAKER_TOOL_RUN_TSC,
            tsc: {
                ok: false,
                errors: error.buildErrors || parseTscOutput(error.rawOutput || error.message),
                message: error.message || String(error),
            },
        };
    }
}

async function attachTscResultAfterEdit(projectRoot, helpers, result, toolName) {
    if (!TSC_AFTER_EACH_EDIT || !result?.ok || !result.path) return result;
    if (toolName !== MAKER_TOOL_APPLY_PATCH && toolName !== MAKER_TOOL_WRITE_FILE) return result;
    if (!/\.(ts|tsx)$/i.test(result.path)) return result;
    if (typeof helpers.runTscCheck !== 'function') return result;
    try {
        await helpers.runTscCheck(projectRoot);
        result.tsc = { ok: true, errors: [] };
    } catch (error) {
        result.tsc = {
            ok: false,
            errors: error.buildErrors || parseTscOutput(error.rawOutput || error.message),
            message: error.message || String(error),
        };
    }
    return result;
}

async function executeApplyPatch(projectRoot, helpers, args = {}, { mode = MAKER_AGENT_TURN_MODE_REPAIR } = {}) {
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

    const cleanPath = normalizeMakerToolPath(filePath);
    if (mode === MAKER_AGENT_TURN_MODE_IMPLEMENT && !IMPLEMENT_EDIT_PATHS.has(cleanPath)) {
        throw new Error(`implement mode apply_patch allowed only for src/main.ts or src/styles.css (got ${cleanPath})`);
    }

    const { cleanPath: resolvedPath, absolutePath } = helpers.safeMakerProjectPath(projectRoot, filePath);
    if (helpers.isProtectedMakerRuntimeFile(resolvedPath)) {
        throw new Error(`apply_patch blocked on protected file: ${resolvedPath}`);
    }

    const currentContent = await fs.promises.readFile(absolutePath, 'utf8');
    const patched = applyPatchReplacements(currentContent, [{
        find,
        replace,
        replaceAll,
    }], { path: resolvedPath });
    const content = helpers.sanitizeMakerMainTsContent(patched.content, resolvedPath);
    await fs.promises.writeFile(absolutePath, content, 'utf8');

    return {
        ok: true,
        tool: MAKER_TOOL_APPLY_PATCH,
        path: resolvedPath,
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
        case MAKER_TOOL_APPLY_PATCH: {
            const result = await executeApplyPatch(projectRoot, helpers, args, options);
            return attachTscResultAfterEdit(projectRoot, helpers, result, toolName);
        }
        case MAKER_TOOL_WRITE_FILE: {
            const result = await executeWriteFile(projectRoot, helpers, args, options);
            return attachTscResultAfterEdit(projectRoot, helpers, result, toolName);
        }
        case MAKER_TOOL_READ_FILE:
            return executeReadFile(projectRoot, helpers, args);
        case MAKER_TOOL_GREP_PROJECT:
            return executeGrepProject(projectRoot, helpers, args);
        case MAKER_TOOL_RUN_TSC:
            return executeRunTsc(projectRoot, helpers);
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

function resolveTurnLimits(mode = MAKER_AGENT_TURN_MODE_REPAIR, { assetKeyCount = 0 } = {}) {
    if (mode === MAKER_AGENT_TURN_MODE_IMPLEMENT) {
        const assetKeys = Math.max(0, Number(assetKeyCount) || 0);
        let maxToolCalls = IMPLEMENT_MAX_TOOL_CALLS;
        if (assetKeys > IMPLEMENT_ASSET_KEY_BONUS_THRESHOLD) {
            const bonus = Math.floor((assetKeys - IMPLEMENT_ASSET_KEY_BONUS_THRESHOLD) / IMPLEMENT_ASSET_KEY_BONUS_STEP);
            maxToolCalls = Math.min(IMPLEMENT_MAX_TOOL_CALLS_CEILING, maxToolCalls + bonus);
        }
        return {
            maxRounds: IMPLEMENT_MAX_ROUNDS,
            maxToolCalls,
            assetKeyCount: assetKeys,
        };
    }
    return {
        maxRounds: REPAIR_MAX_ROUNDS,
        maxToolCalls: REPAIR_MAX_TOOL_CALLS,
        assetKeyCount: 0,
    };
}

function measureMakerAgentMessagesChars(messages = []) {
    return messages.reduce((sum, message) => {
        const contentChars = String(message?.content || '').length;
        const toolCallChars = Array.isArray(message?.tool_calls)
            ? JSON.stringify(message.tool_calls).length
            : 0;
        return sum + contentChars + toolCallChars;
    }, 0);
}

function parseToolMessagePayload(content = '') {
    try {
        return JSON.parse(String(content || ''));
    } catch {
        return null;
    }
}

function isReadFileToolMessage(message = {}) {
    if (message?.role !== 'tool') return false;
    const payload = parseToolMessagePayload(message.content);
    return payload?.tool === MAKER_TOOL_READ_FILE;
}

function isSnapshotUserMessage(message = {}) {
    return message?.role === 'user'
        && String(message?.content || '').includes('Live project files on disk after your last edits');
}

function elideReadFileToolMessage(message = {}) {
    const payload = parseToolMessagePayload(message.content);
    if (!payload || payload.tool !== MAKER_TOOL_READ_FILE) {
        return message;
    }
    const preview = String(payload.content || '').slice(0, READ_FILE_HISTORY_PREVIEW_CHARS);
    return {
        ...message,
        content: JSON.stringify({
            ok: payload.ok,
            tool: payload.tool,
            path: payload.path,
            bytes: payload.bytes,
            truncated: payload.truncated,
            contentPreview: preview ? `${preview}...` : '',
            note: 'Full file content elided from history to save context. Call read_file again for the section you need.',
        }),
    };
}

function elideSnapshotUserMessage(message = {}) {
    return {
        role: 'user',
        content: '[Earlier on-disk file snapshot elided from history. Use read_file or grep_project for current source.]',
    };
}

/**
 * Keep the latest tool context while preventing read_file + snapshot duplication from blowing past provider limits.
 */
export function compactMakerAgentMessages(messages = []) {
    if (!Array.isArray(messages) || messages.length <= 1) {
        return messages;
    }

    const compacted = messages.map((message) => ({ ...message }));
    let latestReadFileIdx = -1;
    for (let index = compacted.length - 1; index >= 0; index -= 1) {
        if (isReadFileToolMessage(compacted[index])) {
            latestReadFileIdx = index;
            break;
        }
    }

    for (let index = 0; index < compacted.length; index += 1) {
        if (isReadFileToolMessage(compacted[index]) && index !== latestReadFileIdx) {
            compacted[index] = elideReadFileToolMessage(compacted[index]);
        }
    }

    let keptLatestSnapshot = false;
    for (let index = compacted.length - 1; index >= 0; index -= 1) {
        if (!isSnapshotUserMessage(compacted[index])) continue;
        if (!keptLatestSnapshot) {
            keptLatestSnapshot = true;
            continue;
        }
        compacted[index] = elideSnapshotUserMessage(compacted[index]);
    }

    if (measureMakerAgentMessagesChars(compacted) <= MAKER_AGENT_MAX_PROMPT_CHARS) {
        return compacted;
    }

    for (let index = 1; index < compacted.length && measureMakerAgentMessagesChars(compacted) > MAKER_AGENT_MAX_PROMPT_CHARS; index += 1) {
        if (isReadFileToolMessage(compacted[index])) {
            compacted[index] = elideReadFileToolMessage(compacted[index]);
            continue;
        }
        if (isSnapshotUserMessage(compacted[index])) {
            compacted[index] = elideSnapshotUserMessage(compacted[index]);
        }
    }

    return compacted;
}

async function appendImplementFileSnapshot(projectRoot, messages, { skipIfReadFileThisRound = false } = {}) {
    if (skipIfReadFileThisRound) {
        return;
    }
    const blocks = [];
    for (const relPath of IMPLEMENT_EDIT_PATHS) {
        try {
            const absolutePath = path.join(projectRoot, relPath);
            const content = await fs.promises.readFile(absolutePath, 'utf8');
            const excerpt = content.length > IMPLEMENT_FILE_SNAPSHOT_CHARS
                ? `${content.slice(0, IMPLEMENT_FILE_SNAPSHOT_CHARS)}\n/* ... truncated (${content.length} chars total). Copy find anchors from this excerpt. */`
                : content;
            blocks.push(`${relPath}:\n${excerpt}`);
        } catch {
            // File may not exist yet.
        }
    }
    if (blocks.length === 0) return;
    messages.push({
        role: 'user',
        content: [
            'Live project files on disk after your last edits — copy find text exactly from here:',
            ...blocks,
        ].join('\n\n'),
    });
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
    assetKeyCount = 0,
    onEditApplied = null,
} = {}) {
    if (!projectRoot || !helpers?.safeMakerProjectPath || !helpers?.isProtectedMakerRuntimeFile || !helpers?.sanitizeMakerMainTsContent) {
        throw new Error('runMakerAgentToolTurn requires projectRoot and path/sanitize helpers');
    }
    if (typeof requestCompletion !== 'function') {
        throw new Error('runMakerAgentToolTurn requires requestCompletion(messages)');
    }

    const limits = resolveTurnLimits(mode, { assetKeyCount });
    const effectiveMaxRounds = maxRounds ?? limits.maxRounds;
    const effectiveMaxToolCalls = maxToolCalls ?? limits.maxToolCalls;

    const messages = [{ role: 'user', content: String(userPrompt || '') }];
    const log = {
        transport: 'nvidia_tools',
        mode,
        rounds: 0,
        toolCalls: 0,
        maxToolCalls: effectiveMaxToolCalls,
        assetKeyCount: limits.assetKeyCount,
        events: [],
    };
    const editsApplied = [];
    let noEditsNeeded = false;
    let notes = [];
    let finished = false;
    let touchedMainTs = false;
    let mainTsCleanReady = false;
    let repairReadOnlyRounds = 0;
    let implementReadOnlyRounds = 0;
    const readPathCounts = new Map();

    for (let round = 0; round < effectiveMaxRounds && !finished; round += 1) {
        log.rounds = round + 1;
        const compactedMessages = compactMakerAgentMessages(messages);
        const promptChars = measureMakerAgentMessagesChars(compactedMessages);
        if (promptChars !== measureMakerAgentMessagesChars(messages)) {
            log.events.push({
                round: round + 1,
                type: 'context_compact',
                beforeChars: measureMakerAgentMessagesChars(messages),
                afterChars: promptChars,
            });
        }
        const message = await requestCompletion(compactedMessages);
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
                    content: 'Implement mode: use read_file/grep_project to inspect, apply_patch or write_file to edit (saved immediately), fix any tsc errors shown in tool results, then finish_inspection when complete.',
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

        let roundEdited = false;
        let roundReadFile = false;
        const readPathsThisRound = new Set();
        toolCallLoop: for (const toolCall of toolCalls) {
            if (log.toolCalls >= effectiveMaxToolCalls) {
                if (mode === MAKER_AGENT_TURN_MODE_IMPLEMENT && touchedMainTs) {
                    finished = true;
                    notes = [`Implement turn capped at ${effectiveMaxToolCalls} tool calls after src/main.ts edits; proceeding to build/sandbox.`];
                    log.events.push({ type: 'cap_graceful_finish', toolCalls: log.toolCalls });
                    break toolCallLoop;
                }
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

            if (toolName === MAKER_TOOL_READ_FILE && result.ok !== false) {
                roundReadFile = true;
                const readPath = result.path;
                const priorReads = readPathCounts.get(readPath) || 0;
                readPathCounts.set(readPath, priorReads + 1);
                if (readPath && readPathsThisRound.has(readPath)) {
                    result.note = `Already read ${readPath} this round. Use apply_patch with find text from the earlier read_file result instead of reading again.`;
                } else if (readPath) {
                    readPathsThisRound.add(readPath);
                }
                if (mode === MAKER_AGENT_TURN_MODE_REPAIR && priorReads >= 1 && !roundEdited) {
                    result.note = `${result.note ? `${result.note} ` : ''}REPAIR: ${readPath} was already read earlier this turn. You must apply_patch or write_file next.`;
                } else if (mode === MAKER_AGENT_TURN_MODE_IMPLEMENT && priorReads >= 1 && !roundEdited) {
                    result.note = `${result.note ? `${result.note} ` : ''}IMPLEMENT: ${readPath} was already read earlier this turn. Use write_file or apply_patch on src/main.ts next.`;
                }
            }

            messages.push({
                role: 'tool',
                tool_call_id: toolCallId,
                content: JSON.stringify(result),
            });

            const editSummary = summarizeEditFromToolResult(result);
            if (editSummary) {
                editsApplied.push(editSummary);
                noEditsNeeded = false;
                roundEdited = true;
                if (editSummary.path === 'src/main.ts') {
                    touchedMainTs = true;
                    if (
                        mode === MAKER_AGENT_TURN_MODE_IMPLEMENT
                        && result?.tsc?.ok === true
                    ) {
                        try {
                            const mainPath = path.join(projectRoot, 'src', 'main.ts');
                            const mainBytes = Buffer.byteLength(await fs.promises.readFile(mainPath, 'utf8'), 'utf8');
                            if (mainBytes >= IMPLEMENT_MAIN_TS_AUTO_FINISH_MIN_BYTES) {
                                mainTsCleanReady = true;
                            }
                        } catch {
                            // ignore — agent may retry on next edit
                        }
                    }
                }
                if (typeof onEditApplied === 'function') {
                    await onEditApplied(editSummary, {
                        round: round + 1,
                        toolCall: log.toolCalls,
                        mode,
                    });
                }
            }

            if (toolName === MAKER_TOOL_FINISH_INSPECTION && result.finished) {
                finished = true;
                noEditsNeeded = Boolean(result.noEditsNeeded) && editsApplied.length === 0;
                notes = Array.isArray(result.notes) ? result.notes : [];
            }
        }

        if (finished) {
            break;
        }

        if (mode === MAKER_AGENT_TURN_MODE_IMPLEMENT && mainTsCleanReady && !finished) {
            finished = true;
            notes = ['Auto-finished implement turn after clean src/main.ts edit — proceeding to sandbox.'];
            log.events.push({ type: 'auto_finish_after_clean_main_ts', toolCalls: log.toolCalls });
            break;
        }

        if ((mode === MAKER_AGENT_TURN_MODE_IMPLEMENT || mode === MAKER_AGENT_TURN_MODE_REPAIR) && roundEdited && !finished) {
            await appendImplementFileSnapshot(projectRoot, messages, { skipIfReadFileThisRound: roundReadFile });
            repairReadOnlyRounds = 0;
            implementReadOnlyRounds = 0;
        } else if (mode === MAKER_AGENT_TURN_MODE_IMPLEMENT && roundReadFile && !roundEdited) {
            implementReadOnlyRounds += 1;
            if (!touchedMainTs && implementReadOnlyRounds > IMPLEMENT_MAX_READ_ONLY_ROUNDS) {
                throw new Error('Implement mode stalled on read-only tool calls — write src/main.ts with write_file now');
            }
            if (implementReadOnlyRounds >= IMPLEMENT_MAX_READ_ONLY_ROUNDS) {
                messages.push({
                    role: 'user',
                    content: 'IMPLEMENT REQUIRED: Stop re-reading files. Call write_file on src/main.ts now with the full highway/runner loop, import keys from ./assetKeys.ts, and drawBackground() for the generated background.',
                });
            }
        } else if (mode === MAKER_AGENT_TURN_MODE_REPAIR && roundReadFile && !roundEdited) {
            repairReadOnlyRounds += 1;
            if (repairReadOnlyRounds > REPAIR_MAX_READ_ONLY_ROUNDS) {
                throw new Error('Repair mode stalled on read-only tool calls — apply_patch or write_file on src/main.ts now');
            }
            if (repairReadOnlyRounds >= REPAIR_MAX_READ_ONLY_ROUNDS) {
                messages.push({
                    role: 'user',
                    content: 'REPAIR REQUIRED: Stop reading files. Call apply_patch or write_file on src/main.ts now to fix the targeted failures from last run evidence.',
                });
            }
        }
    }

    if (!finished && mode === MAKER_AGENT_TURN_MODE_IMPLEMENT && touchedMainTs) {
        finished = true;
        notes = ['Auto-finished implement turn after incremental src/main.ts edits on disk.'];
    }

    if (!finished) {
        noEditsNeeded = editsApplied.length === 0;
        notes = editsApplied.length > 0
            ? [`Tool session ended without finish_inspection; edits were applied (${mode} mode).`]
            : [`Tool session ended without edits (${mode} mode).`];
    }

    if (mode === MAKER_AGENT_TURN_MODE_IMPLEMENT && !touchedMainTs && editsApplied.length === 0) {
        throw new Error('Implement mode requires apply_patch or write_file edits to src/main.ts');
    }

    return {
        noEditsNeeded,
        notes,
        editsApplied,
        log,
        messageCount: messages.length,
        mode,
        touchedMainTs,
    };
}
