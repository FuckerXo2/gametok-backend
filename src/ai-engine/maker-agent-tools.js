import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

import { applyPatchReplacements } from './maker-agent-patches.js';
import { isFreeBuildMode, resolveMakerAgentImplementTurns, resolveMakerAgentInspectionTurns } from './maker-factory-mode.js';
import { parseTscOutput } from './maker-project-compile-gate.js';

export const MAKER_TOOL_APPLY_PATCH = 'apply_patch';
export const MAKER_TOOL_WRITE_FILE = 'write_file';
export const MAKER_TOOL_READ_FILE = 'read_file';
export const MAKER_TOOL_GREP_PROJECT = 'grep_project';
export const MAKER_TOOL_RUN_TSC = 'run_tsc_check';
export const MAKER_TOOL_FINISH_INSPECTION = 'finish_inspection';
export const MAKER_TOOL_RUN_COMMAND = 'run_command';

export const MAKER_AGENT_TURN_MODE_IMPLEMENT = 'implement';
export const MAKER_AGENT_TURN_MODE_REPAIR = 'repair';

const MIN_FIND_LENGTH = 12;
const MAX_WRITE_FILE_CHARS = Math.max(
    8000,
    Math.min(64000, Number(process.env.GAMETOK_MAKER_AGENT_WRITE_FILE_MAX_CHARS || 32000)),
);
const MAX_WRITE_FILE_LINES = Math.max(
    100,
    Math.min(600, Number(process.env.GAMETOK_MAKER_AGENT_WRITE_FILE_MAX_LINES || 350)),
);
const MAX_WRITE_FILE_CHARS_MAIN = Math.max(
    16000,
    Math.min(1000000, Number(process.env.GAMETOK_MAKER_AGENT_MAIN_TS_MAX_CHARS || 1000000)),
);
const DEFAULT_MAX_ROUNDS = 16;
const DEFAULT_MAX_TOOL_CALLS = 24;
const IMPLEMENT_MAX_ROUNDS = Math.max(
    4,
    Math.min(60, Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_MAX_ROUNDS || 60)),
);
const REPAIR_MAX_ROUNDS = Math.max(
    4,
    Math.min(30, Number(process.env.GAMETOK_MAKER_AGENT_REPAIR_MAX_ROUNDS || 30)),
);
const IMPLEMENT_MAX_TOOL_CALLS = Math.max(
    6,
    Math.min(256, Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_MAX_TOOL_CALLS || 256)),
);
const IMPLEMENT_MAX_TOOL_CALLS_CEILING = Math.max(
    IMPLEMENT_MAX_TOOL_CALLS,
    Math.min(512, Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_MAX_TOOL_CALLS_CEILING || 512)),
);
const IMPLEMENT_ASSET_KEY_BONUS_THRESHOLD = Math.max(
    24,
    Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_ASSET_BONUS_THRESHOLD || 40),
);
const IMPLEMENT_ASSET_KEY_BONUS_STEP = Math.max(
    4,
    Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_ASSET_BONUS_STEP || 5),
);
// Single-file architecture (2D and 3D): the model only ever edits main.ts + styles.css.
// Blocking everything else actively steers the model back into one file — it cannot
// reliably wire an invisible multi-file contract (it puts movePlayer in scene.ts while
// main.ts imports it from mechanics.ts). One scope = state can never be undefined.
const IMPLEMENT_EDIT_PATHS = new Set([
    'src/main.ts', 'src/styles.css',
]);

// FREE BUILD: allow the model to organize the game across multiple source files
// (multi-file architecture) instead of being locked to main.ts. Protected kernel
// runtime files are still blocked separately by isProtectedMakerRuntimeFile, and
// path traversal is still guarded by safeMakerProjectPath. 2D and the default
// (flag off) stay single-file. main.ts must remain the entry the kernel imports.
function isImplementEditAllowed(cleanPath = '') {
    if (IMPLEMENT_EDIT_PATHS.has(cleanPath)) return true;
    if (!isFreeBuildMode()) return false;
    if (cleanPath.includes('..')) return false;
    return /^src\/[A-Za-z0-9_./-]+\.(ts|tsx|js|jsx|css)$/.test(cleanPath);
}

// Kernel reference modules the model READS to learn the API but must never edit. Excluded from the
// stuck snapshot — they're large and off-limits; the snapshot targets the model's OWN game modules.
const KERNEL_REFERENCE_FILE = /^src\/(?:threeAssets|iso|sdf2d|bootstrap|assetLoader|assetKeys|dreamModels|vite-env)\.(?:ts|d\.ts)$|^src\/types\//;

// When the model is stuck re-reading instead of editing, pick the files it's actually been paging — its
// own editable game modules, most-read first — so a multi-file 3D build (Game.ts, World.ts, Hud.ts …)
// gets handed back, not just main.ts. Empty result -> caller falls back to main.ts/styles.css.
function pickStuckSnapshotPaths(readPathCounts) {
    return [...readPathCounts.entries()]
        .filter(([p]) => isImplementEditAllowed(p) && !KERNEL_REFERENCE_FILE.test(p))
        .sort((a, b) => b[1] - a[1])
        .map(([p]) => p)
        .slice(0, 6);
}
const IMPLEMENT_FILE_SNAPSHOT_CHARS = Math.max(
    2000,
    Math.min(12000, Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_SNAPSHOT_CHARS || 6000)),
);
const REPAIR_MAX_TOOL_CALLS = Math.max(
    18,
    Math.min(64, Number(process.env.GAMETOK_MAKER_AGENT_REPAIR_MAX_TOOL_CALLS || 48)),
);
const REPAIR_MAX_READ_ONLY_ROUNDS = Math.max(
    1,
    Math.min(12, Number(process.env.GAMETOK_MAKER_AGENT_REPAIR_MAX_READ_ONLY_ROUNDS || 8)),
);
const IMPLEMENT_MAX_READ_ONLY_ROUNDS = Math.max(
    1,
    Math.min(12, Number(process.env.GAMETOK_MAKER_AGENT_IMPLEMENT_MAX_READ_ONLY_ROUNDS || 8)),
);
// After this many read-only rounds with no edit, proactively HAND the model its full source instead of
// letting it keep paging read_file (and eventually getting killed by the stall guard above). Fires once
// per stuck streak; resets when the model actually edits.
const STUCK_READ_FILE_INJECT_AFTER = Math.max(
    1,
    Math.min(IMPLEMENT_MAX_READ_ONLY_ROUNDS, Number(process.env.GAMETOK_MAKER_AGENT_STUCK_SNAPSHOT_AFTER || 3)),
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
    Math.min(48000, Number(process.env.GAMETOK_MAKER_AGENT_READ_FILE_MAX_CHARS || 24000)),
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
                description: 'Read a project file from disk. Use before apply_patch to copy exact find anchors. Large files are paged: if the result says more content remains, call again with the returned nextOffset to read the rest.',
                parameters: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'Project-relative path under src/ or public/, e.g. src/main.ts',
                        },
                        offset: {
                            type: 'number',
                            description: 'Optional 0-based character offset to start reading from. Pass the nextOffset from a previous truncated read to page through the rest of a large file.',
                        },
                        max_chars: {
                            type: 'number',
                            description: 'Optional max chars to return per call (default 24000).',
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
        {
            type: 'function',
            function: {
                name: MAKER_TOOL_RUN_COMMAND,
                description: 'Run a CLI command in the game project directory (e.g. "npm install three", "python3 scripts/create_threejs_game.py"). Do NOT run blocking/interactive commands like "npm run dev". Timeouts after 30 seconds.',
                parameters: {
                    type: 'object',
                    properties: {
                        command: {
                            type: 'string',
                            description: 'The shell command to execute',
                        },
                        reason: {
                            type: 'string',
                            description: 'Why you are running this command',
                        },
                    },
                    required: ['command'],
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

// Invariant: a file the agent is ALLOWED TO WRITE must be fully READABLE in a single read_file call.
// Otherwise it can create a main.ts up to MAX_WRITE_FILE_CHARS_MAIN (96K) yet only ever page it back
// READ_FILE_MAX_CHARS (24K) at a time — a 4x gap. In the repair/implement turn it then botches the
// offset paging and burns the whole turn re-reading instead of editing, which the stall guard kills
// (the "El Observador" failure). Read ceiling therefore tracks the write cap for editable source
// files; reference-only kernel files (sdf2d.ts, iso.ts, threeAssets.ts) keep the small paged cap.
function maxReadCharsForPath(cleanPath = '') {
    if (isMainTsPath(cleanPath)) return MAX_WRITE_FILE_CHARS_MAIN;
    if (isImplementEditAllowed(cleanPath)) return Math.max(READ_FILE_MAX_CHARS, MAX_WRITE_FILE_CHARS);
    return READ_FILE_MAX_CHARS;
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
        // The agent kept burning rounds trying to read root files (index.html, package.json, vite/ts
        // configs) and treating the denial as "file missing / something is wrong." Say plainly what it is.
        throw new Error(`"${cleanPath}" is OUTSIDE your editable area and you don't need it. index.html, package.json, vite/tsconfig and other root files are KERNEL-MANAGED — they're already wired to your code automatically; you never read or edit them. You can only read/write files under src/ and public/. Stop looking for root files and write your game in src/ (start with src/main.ts and your own modules).`);
    }
    const { cleanPath: resolvedPath, absolutePath } = helpers.safeMakerProjectPath(projectRoot, filePath);
    if (helpers.isProtectedMakerRuntimeFile(resolvedPath)) {
        throw new Error(`"${resolvedPath}" is a READ-ONLY kernel runtime file — you CONSUME it (import it and call its exports), never read or edit it. Its API is already described in your prompt. Skip it and write your game in src/main.ts.`);
    }
    let content;
    try {
        content = await fs.promises.readFile(absolutePath, 'utf8');
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            // Reading a file that doesn't exist yet (e.g. a multi-file module the agent plans to create)
            // returned a raw ENOENT that read as "empty/broken". Tell it to just create the file.
            throw new Error(`"${resolvedPath}" does not exist yet — nothing to read. In this scaffold you CREATE new files with write_file; don't read a module before writing it. If you planned this file (e.g. src/game/Game.ts), just write_file it now.`);
        }
        throw err;
    }
    const fileReadCap = maxReadCharsForPath(cleanPath);
    const maxChars = Math.min(
        fileReadCap,
        Math.max(1000, Number(args.max_chars || fileReadCap)),
    );
    // Honor a starting offset so the agent can page through a file larger than one read. Previously
    // there was no offset and the cap was tiny, so a >cap file could ONLY ever return its head — the
    // agent could never see (or fix) the tail, and burned whole turns fighting the tool.
    const offset = Math.min(Math.max(0, Math.floor(Number(args.offset) || 0)), content.length);
    const slice = content.slice(offset, offset + maxChars);
    const end = offset + slice.length;
    const hasMore = end < content.length;
    return {
        ok: true,
        tool: MAKER_TOOL_READ_FILE,
        path: resolvedPath,
        bytes: Buffer.byteLength(content, 'utf8'),
        totalChars: content.length,
        offset,
        nextOffset: hasMore ? end : null,
        truncated: hasMore || offset > 0,
        content: hasMore
            ? `${slice}\n/* ... ${content.length - end} more chars remain. Call read_file again with offset=${end} to continue. */`
            : slice,
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

async function executeRunCommand(projectRoot, args) {
    const { command } = args;
    if (!command || typeof command !== 'string') {
        throw new Error('Command must be a non-empty string');
    }
    
    // Security: Block dangerous host-level networking and file-system destruction commands
    const blocklist = ['rm -rf /', 'rm -rf ~', 'curl', 'wget', 'ssh', 'nc', 'telnet'];
    for (const blocked of blocklist) {
        if (command.includes(blocked)) {
            throw new Error(`Command rejected: contains blocked keyword "${blocked}"`);
        }
    }

    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd: projectRoot,
            timeout: 30000, // 30 second hard timeout
            maxBuffer: 1024 * 1024 * 2 // 2MB max output
        });
        
        return {
            ok: true,
            tool: MAKER_TOOL_RUN_COMMAND,
            command,
            stdout: stdout.substring(0, 4000), // truncate for prompt size limits
            stderr: stderr.substring(0, 4000),
        };
    } catch (err) {
        return {
            ok: false,
            tool: MAKER_TOOL_RUN_COMMAND,
            command,
            error: err.message,
            stdout: err.stdout ? err.stdout.substring(0, 4000) : '',
            stderr: err.stderr ? err.stderr.substring(0, 4000) : '',
        };
    }
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
    if (mode === MAKER_AGENT_TURN_MODE_IMPLEMENT && !isImplementEditAllowed(cleanPath)) {
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
        throw new Error(`write_file content exceeds ${maxChars} chars for ${cleanPath}. Split this file into smaller modules (max ~${MAX_WRITE_FILE_LINES} lines per file). For example, extract entity classes into src/entities/*.ts and systems into src/systems/*.ts.`);
    }

    // Hard line-count enforcement for non-main files. The #1 cause of generation failures
    // is the AI cramming 800+ lines into a single GameScene.ts, which truncates the DeepSeek
    // output mid-stream and produces "Unexpected end of input" syntax errors. By rejecting
    // oversized files at write time, the AI is forced to split into smaller modules.
    if (!isMainTsPath(cleanPath)) {
        const lineCount = content.split('\n').length;
        if (lineCount > MAX_WRITE_FILE_LINES) {
            throw new Error(
                `write_file REJECTED — ${cleanPath} has ${lineCount} lines (max ${MAX_WRITE_FILE_LINES}). `
                + 'Large files cause output truncation and broken builds. '
                + 'Split into smaller files: extract classes/functions into separate modules '
                + '(e.g. src/entities/Player.ts, src/entities/Zombie.ts, src/systems/WaveManager.ts, src/systems/InputHandler.ts, src/ui/HUD.ts). '
                + 'Each file should be focused and under 300 lines. Import them back into the scene file.'
            );
        }
    }

    if (mode === MAKER_AGENT_TURN_MODE_IMPLEMENT && !isImplementEditAllowed(cleanPath)) {
        throw new Error(`implement mode write_file allowed only for ${[...IMPLEMENT_EDIT_PATHS].join(', ')} or (free build) src/**/*.{ts,js,css} (got ${cleanPath})`);
    }

    const { cleanPath: resolvedPath, absolutePath } = helpers.safeMakerProjectPath(projectRoot, filePath);
    if (helpers.isProtectedMakerRuntimeFile(resolvedPath)) {
        throw new Error(`write_file blocked on protected file: ${resolvedPath}`);
    }

    // Case-only filename collision guard (e.g. HUD.ts vs the seed's Hud.ts). On case-insensitive
    // filesystems these are the SAME file and break the TypeScript build with TS1261 — but it only
    // surfaces at the final bundle, turns later, after the model has dug in. Catch it at write time
    // and point the model at the EXACT existing casing so it stays consistent in the file + imports.
    try {
        const base = path.basename(absolutePath);
        const existing = await fs.promises.readdir(path.dirname(absolutePath));
        const clash = existing.find((name) => name !== base && name.toLowerCase() === base.toLowerCase());
        if (clash) {
            const canonical = path.posix.join(path.posix.dirname(resolvedPath), clash);
            throw new Error(`write_file BLOCKED — '${resolvedPath}' collides with existing '${canonical}': they differ only in letter case, which breaks the build on case-insensitive filesystems (TS error TS1261). Do NOT create a case-variant. Use the EXACT existing path '${canonical}' for this file AND in every import that references it (edit that file instead of making a new one).`);
        }
    } catch (err) {
        if (err && typeof err.message === 'string' && err.message.includes('BLOCKED')) throw err;
        // readdir failed only because the directory does not exist yet → no possible collision.
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
        case MAKER_TOOL_RUN_COMMAND:
            return executeRunCommand(projectRoot, args);
        default:
            throw new Error(`Unknown maker tool: ${toolName}`);
    }
}

function summarizeEditFromToolResult(result = {}) {
    if (!result?.ok || !result.path) {
        return null;
    }
    if (result.tool !== MAKER_TOOL_WRITE_FILE && result.tool !== MAKER_TOOL_APPLY_PATCH) {
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
    // We rely on the character limit check below to elide older read_file messages.

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

async function appendImplementFileSnapshot(projectRoot, messages, { skipIfReadFileThisRound = false, full = false, paths = null } = {}) {
    if (skipIfReadFileThisRound) {
        return;
    }
    // `full` hands the model the COMPLETE file un-truncated. Used when it's stuck paging read_file on a
    // large file instead of editing — give it the whole thing so it can stop reading and patch. `paths`
    // overrides the default main.ts/styles.css set: for multi-file 3D builds the model thrashes reading
    // its OWN game modules (src/game/Game.ts, src/world/World.ts, …), so we hand back exactly the files
    // it has been re-reading, not just main.ts.
    const relPaths = Array.isArray(paths) && paths.length > 0
        ? [...new Set(paths)]
        : [...IMPLEMENT_EDIT_PATHS];
    const snapshotCap = full ? MAX_WRITE_FILE_CHARS_MAIN : IMPLEMENT_FILE_SNAPSHOT_CHARS;
    const blocks = [];
    for (const relPath of relPaths) {
        try {
            const absolutePath = path.join(projectRoot, relPath);
            const content = await fs.promises.readFile(absolutePath, 'utf8');
            const excerpt = content.length > snapshotCap
                ? `${content.slice(0, snapshotCap)}\n/* ... truncated (${content.length} chars total). Copy find anchors from this excerpt. */`
                : content;
            blocks.push(`${relPath}:\n${excerpt}`);
        } catch {
            // File may not exist yet.
        }
    }
    if (blocks.length === 0) return;
    const header = full
        ? 'STOP RE-READING — here is the COMPLETE current source on disk. Do NOT call read_file again; copy find anchors from below and apply_patch/write_file the fix NOW:'
        : 'Live project files on disk after your last edits — copy find text exactly from here:';
    messages.push({
        role: 'user',
        content: [header, ...blocks].join('\n\n'),
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
    let injectedStuckFileSnapshot = false;
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

        if (message?.reasoning_content) {
            console.log(`\n🧠 [DeepSeek Thinking - Round ${round + 1}]\n${message.reasoning_content}\n`);
        }
        if (message?.content) {
            console.log(`\n💬 [DeepSeek Text - Round ${round + 1}]\n${message.content}\n`);
        }

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
                // Graceful cap: if the turn already applied real edits, build what we have
                // instead of discarding the whole turn (and the job). A multi-file 3D repair
                // legitimately reads+writes 8 files and can brush the cap right AFTER succeeding;
                // throwing here would toss those passing writes. touchedMainTs keeps the
                // single-file implement case; editsApplied covers multi-file edits in either mode.
                // Only a turn that hit the cap with ZERO edits (model spun on reads) is a real fail.
                if ((mode === MAKER_AGENT_TURN_MODE_IMPLEMENT && touchedMainTs) || editsApplied.length > 0) {
                    finished = true;
                    notes = [`${mode} turn capped at ${effectiveMaxToolCalls} tool calls after ${editsApplied.length} edit(s); proceeding to build/sandbox.`];
                    log.events.push({ type: 'cap_graceful_finish', toolCalls: log.toolCalls, edits: editsApplied.length });
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
                    result.note = `${result.note ? `${result.note} ` : ''}IMPLEMENT: ${readPath} was already read earlier this turn. Use write_file or apply_patch on the appropriate source files next.`;
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
                if (editSummary.path === 'src/main.ts' || editSummary.path.endsWith('.ts')) {
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
            injectedStuckFileSnapshot = false;
        } else if (mode === MAKER_AGENT_TURN_MODE_IMPLEMENT && roundReadFile && !roundEdited) {
            implementReadOnlyRounds += 1;
            // Before nagging or killing: hand the model its full source so it stops paging read_file.
            if (!injectedStuckFileSnapshot && implementReadOnlyRounds >= STUCK_READ_FILE_INJECT_AFTER) {
                const stuckPaths = pickStuckSnapshotPaths(readPathCounts);
                await appendImplementFileSnapshot(projectRoot, messages, { full: true, paths: stuckPaths.length ? stuckPaths : null });
                injectedStuckFileSnapshot = true;
                log.events.push({ type: 'stuck_read_file_full_snapshot_injected', mode, round: round + 1, files: stuckPaths });
            }
            if (!touchedMainTs && implementReadOnlyRounds > IMPLEMENT_MAX_READ_ONLY_ROUNDS) {
                throw new Error('Implement mode stalled on read-only tool calls — start writing code now');
            }
            if (implementReadOnlyRounds >= IMPLEMENT_MAX_READ_ONLY_ROUNDS) {
                messages.push({
                    role: 'user',
                    content: 'IMPLEMENT REQUIRED: Stop re-reading files. Start writing code to implement the game logic using apply_patch or write_file on the appropriate source files.',
                });
            }
        } else if (mode === MAKER_AGENT_TURN_MODE_REPAIR && roundReadFile && !roundEdited) {
            repairReadOnlyRounds += 1;
            if (!injectedStuckFileSnapshot && repairReadOnlyRounds >= STUCK_READ_FILE_INJECT_AFTER) {
                const stuckPaths = pickStuckSnapshotPaths(readPathCounts);
                await appendImplementFileSnapshot(projectRoot, messages, { full: true, paths: stuckPaths.length ? stuckPaths : null });
                injectedStuckFileSnapshot = true;
                log.events.push({ type: 'stuck_read_file_full_snapshot_injected', mode, round: round + 1, files: stuckPaths });
            }
            if (repairReadOnlyRounds > REPAIR_MAX_READ_ONLY_ROUNDS) {
                throw new Error('Repair mode stalled on read-only tool calls — apply_patch or write_file on the appropriate source files now');
            }
            if (repairReadOnlyRounds >= REPAIR_MAX_READ_ONLY_ROUNDS) {
                messages.push({
                    role: 'user',
                    content: 'REPAIR REQUIRED: Stop reading files. Call apply_patch or write_file on the appropriate source files now to fix the targeted failures from last run evidence.',
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
        // A no-edit implement turn is NOT fatal here. We cannot reliably tell the mandatory first
        // build turn from a later visual-polish turn inside the tool runner — the locally recomputed
        // turn counts disagree with the route's actual loop config, which used to make a bonus polish
        // turn throw and DISCARD an already-passing game from an earlier turn. The route already
        // protects the genuine "nothing was ever built" case with evidence-based bareSeed/hollow
        // detection after the turn, and preserves any passing build. So flag no-edits and defer to
        // the route — never crash a working game because a polish turn wrote nothing.
        noEditsNeeded = true;
        console.warn(`⚠️ [Implement Guard] Implement turn produced no edits — deferring to route acceptance gate (non-fatal).`);
    }

    const reads = Array.from(readPathCounts.entries()).map(([p, c]) => `${p} (${c}x)`);
    const writes = editsApplied.filter(e => e.tool === MAKER_TOOL_WRITE_FILE).map(e => e.path);
    const patches = editsApplied.filter(e => e.tool === MAKER_TOOL_APPLY_PATCH).length;
    
    console.log(`\n📊 [DeepSeek Turn Summary - ${mode}]`);
    console.log(`   Files read: ${reads.length ? reads.join(', ') : 'None'}`);
    console.log(`   Files written: ${writes.length ? [...new Set(writes)].join(', ') : 'None'}`);
    console.log(`   Net edits: ${editsApplied.length} (Patches: ${patches})`);
    console.log(`   Finish reason: ${finished ? notes.join(' | ') || 'Finished' : 'Exited loop'}\n`);

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
