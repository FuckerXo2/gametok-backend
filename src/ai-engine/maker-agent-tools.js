import fs from 'fs';
import path from 'path';

import { applyPatchReplacements } from './maker-agent-patches.js';

export const MAKER_TOOL_APPLY_PATCH = 'apply_patch';
export const MAKER_TOOL_WRITE_FILE = 'write_file';
export const MAKER_TOOL_FINISH_INSPECTION = 'finish_inspection';

const MIN_FIND_LENGTH = 12;
const MAX_WRITE_FILE_CHARS = 12000;
const DEFAULT_MAX_ROUNDS = 16;
const DEFAULT_MAX_TOOL_CALLS = 24;

export function useMakerAgentTools() {
    return String(process.env.GAMETOK_MAKER_AGENT_TOOLS || 'true').toLowerCase() !== 'false';
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
                description: 'Write a small file in full. Use only for tiny files like src/styles.css under 12k chars. Prefer apply_patch for src/main.ts.',
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

export function getMakerAgentToolInstructionLines() {
    return [
        'Use NVIDIA tool calls to edit the project. Do NOT return a JSON protocol blob in message content.',
        'Call apply_patch for targeted edits. Copy find text exactly from Project files.',
        'Call write_file only for small files (styles.css, tiny helpers). Never rewrite all of src/main.ts with write_file.',
        'Call finish_inspection when done. Set no_edits_needed=true only if the project already passes the objective.',
        'Make 3-10 focused apply_patch calls per turn when changes are needed.',
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

async function executeApplyPatch(projectRoot, helpers, args = {}) {
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

async function executeWriteFile(projectRoot, helpers, args = {}) {
    const filePath = args.path;
    const content = args.content;

    if (typeof filePath !== 'string' || !filePath.trim()) {
        throw new Error('write_file requires path');
    }
    if (typeof content !== 'string') {
        throw new Error('write_file requires content string');
    }
    if (content.length > MAX_WRITE_FILE_CHARS) {
        throw new Error(`write_file content exceeds ${MAX_WRITE_FILE_CHARS} chars; use apply_patch instead`);
    }

    const { cleanPath, absolutePath } = helpers.safeMakerProjectPath(projectRoot, filePath);
    if (helpers.isProtectedMakerRuntimeFile(cleanPath)) {
        throw new Error(`write_file blocked on protected file: ${cleanPath}`);
    }

    const sanitized = helpers.sanitizeMakerMainTsContent(content, cleanPath);
    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, sanitized, 'utf8');

    return {
        ok: true,
        tool: MAKER_TOOL_WRITE_FILE,
        path: cleanPath,
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

async function executeMakerToolCall(projectRoot, helpers, toolName, rawArgs) {
    const args = parseToolArguments(rawArgs);
    switch (toolName) {
        case MAKER_TOOL_APPLY_PATCH:
            return executeApplyPatch(projectRoot, helpers, args);
        case MAKER_TOOL_WRITE_FILE:
            return executeWriteFile(projectRoot, helpers, args);
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

/**
 * Multi-turn NVIDIA tool session for one file-agent inspection turn.
 * Applies edits immediately so follow-up tool calls see updated files.
 */
export async function runMakerAgentToolTurn({
    userPrompt,
    projectRoot,
    requestCompletion,
    helpers,
    maxRounds = DEFAULT_MAX_ROUNDS,
    maxToolCalls = DEFAULT_MAX_TOOL_CALLS,
} = {}) {
    if (!projectRoot || !helpers?.safeMakerProjectPath || !helpers?.isProtectedMakerRuntimeFile || !helpers?.sanitizeMakerMainTsContent) {
        throw new Error('runMakerAgentToolTurn requires projectRoot and path/sanitize helpers');
    }
    if (typeof requestCompletion !== 'function') {
        throw new Error('runMakerAgentToolTurn requires requestCompletion(messages)');
    }

    const messages = [{ role: 'user', content: String(userPrompt || '') }];
    const log = {
        transport: 'nvidia_tools',
        rounds: 0,
        toolCalls: 0,
        events: [],
    };
    const editsApplied = [];
    let noEditsNeeded = false;
    let notes = [];
    let finished = false;

    for (let round = 0; round < maxRounds && !finished; round += 1) {
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
            if (round >= maxRounds - 1) {
                break;
            }
            messages.push({
                role: 'user',
                content: 'Continue using apply_patch / write_file tools, then call finish_inspection when done.',
            });
            continue;
        }

        for (const toolCall of toolCalls) {
            if (log.toolCalls >= maxToolCalls) {
                throw new Error(`Maker tool turn exceeded max tool calls (${maxToolCalls})`);
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
            }

            if (toolName === MAKER_TOOL_FINISH_INSPECTION && result.finished) {
                finished = true;
                noEditsNeeded = Boolean(result.noEditsNeeded) && editsApplied.length === 0;
                notes = Array.isArray(result.notes) ? result.notes : [];
            }
        }
    }

    if (!finished) {
        noEditsNeeded = editsApplied.length === 0;
        notes = editsApplied.length > 0
            ? ['Tool session ended without finish_inspection; edits were applied.']
            : ['Tool session ended without edits.'];
    }

    return {
        noEditsNeeded,
        notes,
        editsApplied,
        log,
        messageCount: messages.length,
    };
}
