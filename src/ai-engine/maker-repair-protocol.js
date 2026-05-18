import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';

const PROTOCOL_VERSION = 1;

function nowIso() {
    return new Date().toISOString();
}

function normalizeText(value = '') {
    return String(value || '')
        .toLowerCase()
        .replace(/[0-9a-f]{8,}(-[0-9a-f]{4,})*/g, '<id>')
        .replace(/\d+(\.\d+)?/g, '<n>')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
}

function signatureIdFor(task = {}) {
    const source = task.source || 'unknown';
    const templateId = task.templateId || 'any-template';
    const failure = normalizeText(task.failure || task.directRepairTask || task.repair || '');
    const digest = createHash('sha1')
        .update(`${source}|${templateId}|${failure}`)
        .digest('hex')
        .slice(0, 12);
    return `maker-${digest}`;
}

function emptyProtocol() {
    const createdAt = nowIso();
    return {
        version: PROTOCOL_VERSION,
        source: 'gametok-maker-repair-protocol',
        createdAt,
        updatedAt: createdAt,
        entries: [],
        history: [],
    };
}

export function getMakerRepairProtocolPath(rootDir) {
    return path.join(rootDir, 'maker-repair-protocol.json');
}

export async function loadMakerRepairProtocol(rootDir) {
    const protocolPath = getMakerRepairProtocolPath(rootDir);
    try {
        const raw = await fs.promises.readFile(protocolPath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            ...emptyProtocol(),
            ...parsed,
            entries: Array.isArray(parsed.entries) ? parsed.entries : [],
            history: Array.isArray(parsed.history) ? parsed.history : [],
        };
    } catch {
        return emptyProtocol();
    }
}

async function saveMakerRepairProtocol(rootDir, protocol) {
    const protocolPath = getMakerRepairProtocolPath(rootDir);
    await fs.promises.mkdir(path.dirname(protocolPath), { recursive: true });
    protocol.updatedAt = nowIso();
    await fs.promises.writeFile(protocolPath, JSON.stringify(protocol, null, 2), 'utf8');
}

export function buildMakerRepairSignatures(tasks = []) {
    return (Array.isArray(tasks) ? tasks : []).map((task) => ({
        id: signatureIdFor(task),
        source: task.source || 'unknown',
        templateId: task.templateId || null,
        priority: task.priority || 'major',
        failurePattern: normalizeText(task.failure || ''),
        directRepairTask: task.directRepairTask || task.repair || String(task.failure || ''),
        rawFailure: task.failure || '',
    }));
}

export function matchMakerRepairProtocol(protocol, tasks = []) {
    const signatures = buildMakerRepairSignatures(tasks);
    const entries = Array.isArray(protocol?.entries) ? protocol.entries : [];
    return signatures.map((signature) => {
        const entry = entries.find((candidate) => candidate.id === signature.id);
        return {
            ...signature,
            matched: Boolean(entry),
            entry: entry ? {
                id: entry.id,
                verifiedCount: entry.verifiedCount || 0,
                lastVerifiedAt: entry.lastVerifiedAt || null,
                repairTask: entry.repairTask || signature.directRepairTask,
                repairHints: entry.repairHints || [],
                templates: entry.templates || [],
                successfulExamples: entry.successfulExamples || [],
            } : null,
        };
    });
}

export function buildMakerRepairProtocolGuidance(matches = []) {
    const known = (Array.isArray(matches) ? matches : [])
        .filter((match) => match?.matched && match.entry)
        .sort((a, b) => {
            const aVerified = Number(a.entry?.verifiedCount || 0);
            const bVerified = Number(b.entry?.verifiedCount || 0);
            return bVerified - aVerified;
        })
        .slice(0, 6);

    return known.map((match) => ({
        signatureId: match.id,
        source: match.source,
        templateId: match.templateId || match.entry.templateId || null,
        priority: match.priority,
        failedProbe: match.rawFailure,
        directRepairTask: match.entry.repairTask || match.directRepairTask,
        verifiedCount: match.entry.verifiedCount || 0,
        lastVerifiedAt: match.entry.lastVerifiedAt || null,
        repairHints: match.entry.repairHints || [],
        successfulExamples: (match.entry.successfulExamples || []).slice(-3),
    }));
}

export function formatMakerRepairProtocolPromptBlock(matches = []) {
    const guidance = buildMakerRepairProtocolGuidance(matches);
    if (guidance.length === 0) {
        return [
            'Maker repair memory:',
            'No verified prior fix matched these exact failure signatures yet. Repair from the targeted tasks and playbook, then verification will record the outcome.',
        ].join('\n');
    }

    return [
        'Maker repair memory:',
        'The following verified prior fixes match these failure signatures. Treat them as high-priority repair guidance.',
        JSON.stringify(guidance, null, 2),
        '',
        'Repair memory policy:',
        '- Prefer proven repair memory over generic rewrites when it applies to the same direct repair task.',
        '- Reuse the successful implementation pattern, but adapt file names and state variables to this project.',
        '- If a prior fix touched a specific subsystem, inspect the corresponding current file before editing.',
    ].join('\n');
}

export async function recordMakerRepairOutcome(rootDir, {
    jobId,
    attempt = null,
    templateId = null,
    tasks = [],
    playbook = null,
    repairNotes = [],
    applied = [],
    verified = false,
    failure = null,
} = {}) {
    const protocol = await loadMakerRepairProtocol(rootDir);
    const signatures = buildMakerRepairSignatures(tasks);
    const timestamp = nowIso();

    for (const signature of signatures) {
        let entry = protocol.entries.find((candidate) => candidate.id === signature.id);
        if (!entry) {
            entry = {
                id: signature.id,
                source: signature.source,
                templateId: signature.templateId || templateId || null,
                failurePattern: signature.failurePattern,
                repairTask: signature.directRepairTask,
                rawFailures: [],
                repairHints: [],
                templates: [],
                seenCount: 0,
                verifiedCount: 0,
                failedCount: 0,
                createdAt: timestamp,
                updatedAt: timestamp,
                lastSeenAt: timestamp,
                lastVerifiedAt: null,
            };
            protocol.entries.push(entry);
        }

        entry.seenCount = (entry.seenCount || 0) + 1;
        entry.lastSeenAt = timestamp;
        entry.updatedAt = timestamp;
        if (verified) {
            entry.verifiedCount = (entry.verifiedCount || 0) + 1;
            entry.lastVerifiedAt = timestamp;
            const appliedFiles = Array.isArray(applied) ? applied.map((item) => item?.path || item).filter(Boolean) : [];
            if (!Array.isArray(entry.successfulExamples)) entry.successfulExamples = [];
            entry.successfulExamples.push({
                jobId,
                attempt,
                repairNotes: Array.isArray(repairNotes) ? repairNotes.slice(0, 6) : [],
                appliedFiles,
                verifiedAt: timestamp,
            });
            entry.successfulExamples = entry.successfulExamples.slice(-5);
        } else {
            entry.failedCount = (entry.failedCount || 0) + 1;
        }
        if (signature.rawFailure && !entry.rawFailures.includes(signature.rawFailure)) {
            entry.rawFailures.push(signature.rawFailure);
            entry.rawFailures = entry.rawFailures.slice(-8);
        }
        if (templateId && !entry.templates.includes(templateId)) {
            entry.templates.push(templateId);
        }
        const recipeTitles = Array.isArray(playbook?.recipes)
            ? playbook.recipes.map((recipe) => recipe?.title).filter(Boolean)
            : [];
        for (const hint of [...recipeTitles, ...repairNotes].filter(Boolean)) {
            if (!entry.repairHints.includes(hint)) entry.repairHints.push(hint);
        }
        entry.repairHints = entry.repairHints.slice(-12);
    }

    protocol.history.push({
        id: randomUUID(),
        jobId,
        attempt,
        templateId,
        verified: Boolean(verified),
        failure,
        signatureIds: signatures.map((signature) => signature.id),
        appliedFiles: Array.isArray(applied) ? applied.map((item) => item?.path || item).filter(Boolean) : [],
        createdAt: timestamp,
    });
    protocol.history = protocol.history.slice(-250);

    await saveMakerRepairProtocol(rootDir, protocol);
    return protocol;
}
