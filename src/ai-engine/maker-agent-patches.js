export const MAKER_PROTOCOL_KIND_PATCH = 'maker_protocol_patch';
export const MAKER_PROTOCOL_VERSION_PATCH = 2;

const MIN_FIND_LENGTH = 12;
const MAX_REPLACEMENTS_PER_PATCH = 16;
const MAX_PATCHES_PER_RESPONSE = 6;

export function getMakerPatchJsonSchemaExample(extra = {}) {
    return {
        protocolVersion: MAKER_PROTOCOL_VERSION_PATCH,
        kind: MAKER_PROTOCOL_KIND_PATCH,
        diagnosis: {
            errorCode: 'string',
            rootCause: 'string',
            matchedProtocolRuleIds: ['string'],
        },
        patches: [
            {
                path: 'src/main.ts',
                replacements: [
                    {
                        find: '// TODO: Phase 2 agent implements timed_order_cooking loop here.',
                        replace: '  updateCustomers(dt);\n  updateStations(dt);\n',
                        reason: 'Implement core loop body inside stepGame',
                    },
                ],
            },
        ],
        notes: ['short notes'],
        noEditsNeeded: false,
        ...extra,
    };
}

export function getMakerPatchProtocolRuleLines() {
    return [
        '- CRITICAL TRANSPORT RULE: Prefer patch-based edits. Return small find/replace pairs, NOT full file contents.',
        '- Use protocolVersion 2 and kind "maker_protocol_patch".',
        '- patches[].path is a project-relative path. patches[].replacements[] uses plain JSON strings for find and replace.',
        '- CRITICAL: find/replace strings must be valid JSON — escape newlines as \\n, tabs as \\t, quotes as \\". Never paste raw line breaks inside JSON string values.',
        '- Each find MUST be copied exactly from the current Project files text, including whitespace and punctuation.',
        '- Each find must be unique in the target file. If it would match twice, lengthen find with more surrounding lines.',
        '- Keep each replacement focused. Use 3-10 replacements per turn instead of one giant rewrite.',
        '- Good patch targets: stepGame loop TODO, drawPlayer/renderAll bodies, resetGame setup, probe methods, styles.css rules.',
        '- After patches apply, the project must compile with tsc. Syntax errors cause automatic rejection.',
        '- Full-file files[] base64 edits are fallback only for tiny files under 4000 chars (for example src/styles.css). Never base64-encode all of src/main.ts.',
        '- If already compliant, return {"patches":[],"notes":["already compliant"],"noEditsNeeded":true}.',
        '- If lastRunEvidence lists buildFailure.errors, patch the exact broken region first.',
    ];
}

export function normalizeMakerPatchReplacement(replacement, { path = '', index = 0 } = {}) {
    if (!replacement || typeof replacement !== 'object') {
        throw new Error(`Patch replacement ${index + 1} for ${path} is invalid.`);
    }
    const find = replacement.find;
    const replace = replacement.replace;
    if (typeof find !== 'string' || !find.trim()) {
        throw new Error(`Patch replacement ${index + 1} for ${path} is missing find text.`);
    }
    if (find.length < MIN_FIND_LENGTH) {
        throw new Error(`Patch replacement ${index + 1} for ${path} find text is too short; include more surrounding context.`);
    }
    if (typeof replace !== 'string') {
        throw new Error(`Patch replacement ${index + 1} for ${path} is missing replace text.`);
    }
    return {
        find,
        replace,
        replaceAll: Boolean(replacement.replaceAll),
        reason: typeof replacement.reason === 'string' ? replacement.reason.slice(0, 240) : null,
    };
}

export function normalizeMakerPatchEntry(patch, { index = 0 } = {}) {
    if (!patch || typeof patch.path !== 'string') {
        throw new Error(`Patch entry ${index + 1} is missing path.`);
    }
    const replacements = Array.isArray(patch.replacements) ? patch.replacements : [];
    if (replacements.length === 0) {
        throw new Error(`Patch entry ${patch.path} has no replacements.`);
    }
    if (replacements.length > MAX_REPLACEMENTS_PER_PATCH) {
        throw new Error(`Patch entry ${patch.path} has too many replacements (${replacements.length}).`);
    }
    return {
        path: patch.path,
        replacements: replacements.map((replacement, replacementIndex) => (
            normalizeMakerPatchReplacement(replacement, { path: patch.path, index: replacementIndex })
        )),
    };
}

export function normalizeMakerPatchesFromParsed(parsed = {}) {
    const patches = Array.isArray(parsed.patches) ? parsed.patches : [];
    if (patches.length > MAX_PATCHES_PER_RESPONSE) {
        throw new Error(`Maker patch response has too many patch entries (${patches.length}).`);
    }
    return patches.map((patch, index) => normalizeMakerPatchEntry(patch, { index }));
}

export function applyPatchReplacements(content = '', replacements = [], { path = '' } = {}) {
    let output = String(content ?? '');
    const applied = [];

    for (let index = 0; index < replacements.length; index += 1) {
        const replacement = replacements[index];
        const find = replacement.find;
        const replace = replacement.replace;
        const matches = output.split(find).length - 1;

        if (matches === 0) {
            throw new Error(`Patch for ${path} could not find anchor ${index + 1}: ${find.slice(0, 100)}`);
        }
        if (matches > 1 && !replacement.replaceAll) {
            throw new Error(`Patch for ${path} anchor ${index + 1} matched ${matches} times; make find more specific.`);
        }

        output = replacement.replaceAll || matches > 1
            ? output.split(find).join(replace)
            : output.replace(find, replace);

        applied.push({
            index: index + 1,
            findPreview: find.slice(0, 120),
            replaceChars: replace.length,
            matchCount: matches,
        });
    }

    return { content: output, applied };
}

export function validateMakerPatchProtocolPayload(parsed = {}) {
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Maker protocol response was not a JSON object.');
    }

    const patchEntries = Array.isArray(parsed.patches) ? parsed.patches : [];
    const fileEntries = Array.isArray(parsed.files) ? parsed.files : [];

    if (parsed.noEditsNeeded || (patchEntries.length === 0 && fileEntries.length === 0)) {
        return parsed;
    }

    if (patchEntries.length > 0) {
        normalizeMakerPatchesFromParsed(parsed);
    }

    return parsed;
}
