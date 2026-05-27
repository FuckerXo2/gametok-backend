export const MAKER_FILE_CONTENT_ENCODING_BASE64 = 'base64';

const BASE64_ALPHABET = /^[A-Za-z0-9+/]*={0,2}$/;
const PLAIN_SOURCE_PREFIX = /^(import |export |const |let |var |function |\/\/|\/\*|<!DOCTYPE|<html|\{)/;

export function encodeMakerFileContent(content = '') {
    return Buffer.from(String(content), 'utf8').toString('base64');
}

export function normalizeBase64Payload(payload = '') {
    const cleaned = String(payload || '').replace(/\s+/g, '');
    if (!cleaned) {
        throw new Error('base64 payload is empty');
    }
    if (!BASE64_ALPHABET.test(cleaned)) {
        throw new Error('content is not valid base64 alphabet');
    }
    if (cleaned.length % 4 !== 0) {
        throw new Error('base64 length is not a multiple of 4');
    }
    return cleaned;
}

export function looksLikePlainSourceText(payload = '', filePath = '') {
    if (!/\.(ts|tsx|js|jsx|css|html|json|txt|md)$/i.test(filePath)) {
        return false;
    }
    const trimmed = String(payload || '').trimStart();
    return PLAIN_SOURCE_PREFIX.test(trimmed);
}

export function sanitizeMakerTextContent(filePath = '', content = '') {
    if (!/\.(ts|tsx|js|jsx|css|html|json|txt|md)$/i.test(filePath)) {
        return content;
    }
    let sanitized = String(content || '');
    if (sanitized.includes('\0')) {
        sanitized = sanitized.replace(/\0/g, '');
    }
    sanitized = sanitized.replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, '');
    return sanitized;
}

function countNullBytes(text = '') {
    let count = 0;
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '\0') count += 1;
    }
    return count;
}

export function decodeBase64FileContent(payload = '', filePath = '') {
    let cleaned;
    try {
        cleaned = normalizeBase64Payload(payload);
    } catch (error) {
        if (looksLikePlainSourceText(payload, filePath)) {
            return sanitizeMakerTextContent(filePath, payload);
        }
        throw error;
    }

    const buffer = Buffer.from(cleaned, 'base64');
    if (!buffer.length) {
        throw new Error('base64 decode returned empty content');
    }

    if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
        return sanitizeMakerTextContent(filePath, buffer.toString('utf16le'));
    }
    if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
        return sanitizeMakerTextContent(filePath, buffer.toString('utf16be'));
    }

    const utf8 = buffer.toString('utf8');
    const nullsInUtf8 = countNullBytes(utf8);
    if (nullsInUtf8 === 0) {
        return sanitizeMakerTextContent(filePath, utf8);
    }

    const utf16le = sanitizeMakerTextContent(filePath, buffer.toString('utf16le'));
    if (countNullBytes(utf16le) < nullsInUtf8) {
        return utf16le;
    }

    return sanitizeMakerTextContent(filePath, utf8);
}

export function validateMakerFileContent(filePath = '', content = '') {
    if (typeof content !== 'string') {
        throw new Error(`Maker file edit ${filePath} decoded to non-string content.`);
    }
    if (/\.(ts|tsx|js|jsx)$/i.test(filePath) && content.length > 240 && !/[\r\n]/.test(content)) {
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
            decoded = decodeBase64FileContent(payload, file.path);
        } catch (error) {
            throw new Error(`Maker file edit ${file.path} has invalid base64 content: ${error.message}`);
        }
    } else if (typeof file.content !== 'string') {
        throw new Error(`Maker file edit ${file.path} is missing string content.`);
    } else {
        decoded = sanitizeMakerTextContent(file.path, file.content);
    }

    validateMakerFileContent(file.path, decoded);
    return { path: file.path, content: decoded };
}

export function normalizeMakerProtocolResponse(parsed, { requireFiles = false } = {}) {
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Maker protocol response was not a JSON object.');
    }

    const files = [];
    const decodeErrors = [];
    for (const file of Array.isArray(parsed.files) ? parsed.files : []) {
        try {
            files.push(normalizeMakerFileEdit(file));
        } catch (error) {
            decodeErrors.push(error.message || String(error));
        }
    }

    if (decodeErrors.length > 0 && (requireFiles || files.length === 0)) {
        throw new Error(decodeErrors[0]);
    }

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
        notes: [
            ...decodeErrors.map((message) => `decode rejected: ${message}`),
            ...(Array.isArray(parsed.notes) ? parsed.notes.map(String).slice(0, 12) : []),
        ].slice(0, 12),
        noEditsNeeded: Boolean(parsed.noEditsNeeded) || files.length === 0,
        decodeErrors,
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
        '- Base64 must encode UTF-8 text only (not UTF-16). Use standard base64 alphabet (A-Z, a-z, 0-9, +, /, =).',
        '- Put the UTF-8 file body in "content" as one continuous base64 string with no raw source code.',
        '- Do NOT put raw TypeScript, HTML, CSS, or JSON source inside JSON string literals.',
        '- Do NOT use escaped newlines (\\n), backslashes, or quotes for source code in JSON strings.',
        '- Small files still use base64. For no edits, return {"files":[],"notes":["already compliant"],"noEditsNeeded":true}.',
        '- After decode, the TypeScript must compile with tsc. Invalid syntax, truncated files, or broken template literals will be rejected.',
        '- If lastRunEvidence lists buildFailure.errors, fix every listed TS error before making other changes.',
    ];
}
