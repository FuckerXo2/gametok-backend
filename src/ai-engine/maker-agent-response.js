export const MAKER_FILE_CONTENT_ENCODING_BASE64 = 'base64';

export function encodeMakerFileContent(content = '') {
    return Buffer.from(String(content), 'utf8').toString('base64');
}

export function validateMakerFileContent(filePath = '', content = '') {
    if (typeof content !== 'string') {
        throw new Error(`Maker file edit ${filePath} decoded to non-string content.`);
    }
    if (content.includes('\0')) {
        throw new Error(`Maker file edit ${filePath} contains null bytes after decode.`);
    }
    if (/\.(ts|tsx|js|jsx)$/i.test(filePath) && content.length > 0 && !/[\r\n]/.test(content) && content.length > 120) {
        throw new Error(`Maker file edit ${filePath} looks like a single-line blob; base64 decode may be corrupted.`);
    }
}

export function normalizeMakerFileEdit(file) {
    if (!file || typeof file.path !== 'string') {
        throw new Error('Maker file edit is missing a path.');
    }

    const encoding = String(file.contentEncoding || file.encoding || '').trim().toLowerCase();
    const base64Payload = typeof file.contentBase64 === 'string' ? file.contentBase64 : null;
    let decoded;

    if (encoding === MAKER_FILE_CONTENT_ENCODING_BASE64 || base64Payload) {
        const payload = base64Payload || file.content;
        if (typeof payload !== 'string' || !payload.trim()) {
            throw new Error(`Maker file edit ${file.path} requires base64 content.`);
        }
        try {
            decoded = Buffer.from(payload.replace(/\s+/g, ''), 'base64').toString('utf8');
            if (!decoded && payload.replace(/\s+/g, '').length > 0) {
                throw new Error('base64 decode returned empty content');
            }
        } catch (error) {
            throw new Error(`Maker file edit ${file.path} has invalid base64 content: ${error.message}`);
        }
    } else if (typeof file.content !== 'string') {
        throw new Error(`Maker file edit ${file.path} is missing string content.`);
    } else {
        decoded = file.content;
    }

    validateMakerFileContent(file.path, decoded);
    return { path: file.path, content: decoded };
}

export function normalizeMakerProtocolResponse(parsed, { requireFiles = false } = {}) {
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Maker protocol response was not a JSON object.');
    }

    const files = Array.isArray(parsed.files)
        ? parsed.files.map((file) => normalizeMakerFileEdit(file))
        : [];

    if (requireFiles && files.length === 0) {
        throw new Error('Maker protocol response did not include any file edits.');
    }

    const actions = Array.isArray(parsed.actions)
        ? parsed.actions.filter((action) => action && typeof action.type === 'string')
        : [];

    return {
        protocolVersion: parsed.protocolVersion || 1,
        kind: parsed.kind || 'maker_protocol_repair',
        diagnosis: parsed.diagnosis || null,
        actions,
        files,
        notes: Array.isArray(parsed.notes) ? parsed.notes.map(String).slice(0, 12) : [],
        noEditsNeeded: Boolean(parsed.noEditsNeeded) || files.length === 0,
    };
}

export function getMakerFileJsonSchemaExample(extra = {}) {
    return {
        protocolVersion: 1,
        kind: 'maker_protocol_repair',
        diagnosis: {
            errorCode: 'string',
            rootCause: 'string',
            matchedProtocolRuleIds: ['string'],
        },
        actions: [
            {
                type: 'edit',
                path: 'src/main.ts',
                reason: 'string',
            },
        ],
        files: [
            {
                path: 'src/main.ts',
                contentEncoding: MAKER_FILE_CONTENT_ENCODING_BASE64,
                content: encodeMakerFileContent('import "./styles.css";\n'),
            },
        ],
        notes: ['short notes'],
        noEditsNeeded: false,
        ...extra,
    };
}

export function getMakerFileJsonEncodingRuleLines() {
    return [
        '- CRITICAL JSON TRANSPORT RULE: Every file edit MUST use contentEncoding "base64".',
        '- Put the UTF-8 file body in "content" as standard base64 text only (A-Z, a-z, 0-9, +, /, =).',
        '- Do NOT put raw TypeScript, HTML, CSS, or JSON source inside JSON string literals.',
        '- Do NOT use escaped newlines (\\n), backslashes, or quotes for source code in JSON strings.',
        '- Small files still use base64. For no edits, return {"files":[],"notes":["already compliant"],"noEditsNeeded":true}.',
        '- After decode, the TypeScript must compile with tsc. Invalid syntax, truncated files, or broken template literals will be rejected.',
        '- If lastRunEvidence lists buildFailure.errors, fix every listed TS error before making other changes.',
    ];
}
