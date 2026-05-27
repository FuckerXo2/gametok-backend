import {
    getMakerPatchJsonSchemaExample,
    getMakerPatchProtocolRuleLines,
    normalizeMakerPatchesFromParsed,
    validateMakerPatchProtocolPayload,
} from './maker-agent-patches.js';

export const MAKER_FILE_CONTENT_ENCODING_BASE64 = 'base64';

const BASE64_ALPHABET = /^[A-Za-z0-9+/]*={0,2}$/;
const PLAIN_SOURCE_PREFIX = /^(import |export |const |let |var |function |\/\/|\/\*|<!DOCTYPE|<html|\{)/;

export function encodeMakerFileContent(content = '') {
    return Buffer.from(String(content), 'utf8').toString('base64');
}

export function getMakerFileBase64Payload(file = {}) {
    if (Array.isArray(file.contentParts) && file.contentParts.length > 0) {
        return file.contentParts.map(String).join('');
    }
    if (typeof file.contentBase64 === 'string') {
        return file.contentBase64;
    }
    return file.content;
}

export function repairBase64Payload(payload = '') {
    let cleaned = String(payload || '').replace(/\s+/g, '');
    cleaned = cleaned.replace(/[^A-Za-z0-9+/=]/g, '');
    cleaned = cleaned.replace(/=+$/, '');

    if (!cleaned) {
        throw new Error('base64 payload is empty');
    }

    let remainder = cleaned.length % 4;
    if (remainder === 1) {
        cleaned = cleaned.slice(0, -1);
        remainder = cleaned.length % 4;
    }

    if (remainder === 2 || remainder === 3) {
        cleaned += '='.repeat(4 - remainder);
    }

    if (!BASE64_ALPHABET.test(cleaned)) {
        throw new Error('content is not valid base64 alphabet');
    }

    return cleaned;
}

export function normalizeBase64Payload(payload = '') {
    const cleaned = String(payload || '').replace(/\s+/g, '');
    if (!cleaned) {
        throw new Error('base64 payload is empty');
    }

    if (BASE64_ALPHABET.test(cleaned) && cleaned.length % 4 === 0) {
        return cleaned;
    }

    return repairBase64Payload(payload);
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
    const payload = getMakerFileBase64Payload(file);
    let decoded;

    if (encoding === MAKER_FILE_CONTENT_ENCODING_BASE64
        || Array.isArray(file.contentParts)
        || typeof file.contentBase64 === 'string') {
        if (typeof payload !== 'string' || !payload.trim()) {
            throw new Error(`Maker file edit ${file.path} requires base64 content.`);
        }
        try {
            decoded = decodeBase64FileContent(payload, file.path);
        } catch (error) {
            if (looksLikePlainSourceText(payload, file.path)) {
                decoded = sanitizeMakerTextContent(file.path, payload);
            } else {
                throw new Error(`Maker file edit ${file.path} has invalid base64 content: ${error.message}`);
            }
        }
    } else if (typeof file.content !== 'string') {
        throw new Error(`Maker file edit ${file.path} is missing string content.`);
    } else {
        decoded = sanitizeMakerTextContent(file.path, file.content);
    }

    validateMakerFileContent(file.path, decoded);
    return { path: file.path, content: decoded };
}

export function normalizeMakerProtocolResponse(parsed, { requireFiles = false, requireEdits = false } = {}) {
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

    let patches = [];
    const patchErrors = [];
    if (Array.isArray(parsed.patches) && parsed.patches.length > 0) {
        try {
            patches = normalizeMakerPatchesFromParsed(parsed);
        } catch (error) {
            patchErrors.push(error.message || String(error));
        }
    }

    if (patchErrors.length > 0 && (requireEdits || patches.length === 0)) {
        throw new Error(patchErrors[0]);
    }

    if (decodeErrors.length > 0 && (requireFiles || (files.length === 0 && patches.length === 0))) {
        throw new Error(decodeErrors[0]);
    }

    if (requireFiles && files.length === 0 && patches.length === 0) {
        throw new Error('Maker protocol response did not include any file edits.');
    }

    if (requireEdits && files.length === 0 && patches.length === 0 && !parsed.noEditsNeeded) {
        throw new Error('Maker protocol response did not include any patches or file edits.');
    }

    const actions = Array.isArray(parsed.actions)
        ? parsed.actions.filter((action) => action && typeof action.type === 'string')
        : [];

    const hasEdits = files.length > 0 || patches.length > 0;

    return {
        protocolVersion: parsed.protocolVersion || (patches.length > 0 ? 2 : 1),
        kind: parsed.kind || (patches.length > 0 ? 'maker_protocol_patch' : 'maker_protocol_repair'),
        diagnosis: parsed.diagnosis || null,
        actions,
        patches,
        files,
        notes: [
            ...patchErrors.map((message) => `patch rejected: ${message}`),
            ...decodeErrors.map((message) => `decode rejected: ${message}`),
            ...(Array.isArray(parsed.notes) ? parsed.notes.map(String).slice(0, 12) : []),
        ].slice(0, 12),
        noEditsNeeded: Boolean(parsed.noEditsNeeded) || !hasEdits,
        decodeErrors,
        patchErrors,
    };
}

export function validateMakerProtocolJsonPayload(parsed) {
    validateMakerPatchProtocolPayload(parsed);

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
        return parsed;
    }

    const normalized = normalizeMakerProtocolResponse(parsed);
    if (normalized.files.length === 0) {
        throw new Error(normalized.decodeErrors?.[0] || 'Maker file payloads could not be decoded.');
    }

    return parsed;
}

export function getMakerFileJsonSchemaExample(extra = {}) {
    return getMakerPatchJsonSchemaExample(extra);
}

export function getMakerFileJsonEncodingRuleLines() {
    return getMakerPatchProtocolRuleLines();
}
