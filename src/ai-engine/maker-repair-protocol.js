import { createHash, randomUUID } from 'crypto';
import pool from '../db.js';

const PROTOCOL_VERSION = 2;

// ── Schema bootstrap ──────────────────────────────────────────────────
let schemaReady = null;

async function ensureRepairProtocolSchema() {
    if (!schemaReady) {
        schemaReady = pool.query(`
            CREATE TABLE IF NOT EXISTS maker_repair_entries (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL DEFAULT 'unknown',
                template_id TEXT,
                failure_pattern TEXT NOT NULL DEFAULT '',
                repair_task TEXT NOT NULL DEFAULT '',
                raw_failures JSONB DEFAULT '[]'::jsonb,
                repair_hints JSONB DEFAULT '[]'::jsonb,
                templates JSONB DEFAULT '[]'::jsonb,
                successful_examples JSONB DEFAULT '[]'::jsonb,
                seen_count INTEGER NOT NULL DEFAULT 0,
                verified_count INTEGER NOT NULL DEFAULT 0,
                failed_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                last_seen_at TIMESTAMP DEFAULT NOW(),
                last_verified_at TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS maker_repair_history (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                job_id TEXT,
                attempt INTEGER,
                template_id TEXT,
                verified BOOLEAN NOT NULL DEFAULT false,
                failure TEXT,
                signature_ids JSONB DEFAULT '[]'::jsonb,
                applied_files JSONB DEFAULT '[]'::jsonb,
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_repair_entries_template ON maker_repair_entries(template_id);
            CREATE INDEX IF NOT EXISTS idx_repair_history_job ON maker_repair_history(job_id);
        `);
    }
    return schemaReady;
}

// ── Helpers ───────────────────────────────────────────────────────────
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

// ── Public API (drop-in replacements) ─────────────────────────────────

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

export function getMakerRepairProtocolPath(rootDir) {
    return 'postgres://maker_repair_entries';
}

export async function loadMakerRepairProtocol(_rootDir) {
    await ensureRepairProtocolSchema();
    try {
        const entriesRes = await pool.query(
            `SELECT * FROM maker_repair_entries ORDER BY verified_count DESC, seen_count DESC LIMIT 200`
        );
        const entries = entriesRes.rows.map(row => ({
            id: row.id,
            source: row.source,
            templateId: row.template_id,
            failurePattern: row.failure_pattern,
            repairTask: row.repair_task,
            rawFailures: row.raw_failures || [],
            repairHints: row.repair_hints || [],
            templates: row.templates || [],
            successfulExamples: row.successful_examples || [],
            seenCount: row.seen_count,
            verifiedCount: row.verified_count,
            failedCount: row.failed_count,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            lastSeenAt: row.last_seen_at,
            lastVerifiedAt: row.last_verified_at,
        }));

        // Derive evolved rules in-memory (no need to persist these)
        const evolvedRules = entries
            .filter(e => e.verifiedCount >= 2 || e.seenCount >= 4)
            .map(entry => deriveRuleFromEntry(entry))
            .filter(Boolean)
            .slice(0, 80);

        return {
            version: PROTOCOL_VERSION,
            source: 'gametok-maker-repair-protocol-pg',
            entries,
            evolvedRules,
            history: [],
        };
    } catch (err) {
        console.error('[Repair Protocol] DB load failed, returning empty:', err.message);
        return { version: PROTOCOL_VERSION, source: 'empty', entries: [], evolvedRules: [], history: [] };
    }
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
                failedCount: entry.failedCount || 0,
                seenCount: entry.seenCount || 0,
                lastVerifiedAt: entry.lastVerifiedAt || null,
                repairTask: entry.repairTask || signature.directRepairTask,
                repairHints: entry.repairHints || [],
                templates: entry.templates || [],
                successfulExamples: entry.successfulExamples || [],
            } : null,
        };
    });
}

/**
 * Returns true if this crash has been seen 3+ times and NEVER been successfully repaired.
 * In that case, don't waste time retrying — just send the game as-is.
 */
export function shouldSkipRepair(protocolMatches = []) {
    if (!Array.isArray(protocolMatches) || protocolMatches.length === 0) return false;
    
    const hopeless = protocolMatches.filter(m => {
        if (!m.matched || !m.entry) return false;
        // Seen 3+ times, never verified, failed 3+ times
        return m.entry.seenCount >= 3 && m.entry.verifiedCount === 0 && m.entry.failedCount >= 3;
    });

    // If ALL crash signatures are hopeless, skip repair
    if (hopeless.length > 0 && hopeless.length === protocolMatches.filter(m => m.matched).length) {
        console.warn(`🧠 [Repair Memory] ALL ${hopeless.length} crash signatures are known-hopeless (seen ${hopeless[0].entry.seenCount}x, never fixed). Skipping repair loop.`);
        return true;
    }

    return false;
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
        failedCount: match.entry.failedCount || 0,
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

// ── Evolved rules (computed in-memory from DB entries) ────────────────

function ruleIdFor(entry) {
    const digest = createHash('sha1')
        .update(`${entry.source}|${entry.templateId || 'any-template'}|${entry.repairTask || entry.failurePattern}`)
        .digest('hex')
        .slice(0, 10);
    return `maker-rule-${digest}`;
}

function deriveRuleFromEntry(entry) {
    const verifiedCount = Number(entry.verifiedCount || 0);
    const seenCount = Number(entry.seenCount || 0);
    if (verifiedCount < 2 && seenCount < 4) return null;

    const topHints = Array.isArray(entry.repairHints) ? entry.repairHints.slice(-5) : [];
    const successfulFiles = new Set();
    for (const example of entry.successfulExamples || []) {
        for (const file of example.appliedFiles || []) successfulFiles.add(file);
    }

    return {
        id: ruleIdFor(entry),
        source: entry.source || 'unknown',
        templateId: entry.templateId || null,
        repairTask: entry.repairTask || 'Repair repeated maker failure.',
        confidence: verifiedCount >= 3 ? 'high' : verifiedCount >= 1 ? 'medium' : 'low',
        evidence: {
            seenCount,
            verifiedCount,
            failedCount: Number(entry.failedCount || 0),
            lastVerifiedAt: entry.lastVerifiedAt || null,
        },
        guidance: [
            `When this failure appears, treat "${entry.repairTask || entry.failurePattern}" as the primary repair objective.`,
            'Repair the live gameplay state and the probe API together; do not patch the probe with hardcoded answers.',
            ...topHints.map((hint) => `Prior successful repair hint: ${hint}`),
        ].slice(0, 8),
        likelyFiles: Array.from(successfulFiles).slice(0, 8),
    };
}

export function evolveMakerRepairProtocol(protocol) {
    const entries = Array.isArray(protocol?.entries) ? protocol.entries : [];
    const evolvedRules = entries
        .map(entry => deriveRuleFromEntry(entry))
        .filter(Boolean)
        .sort((a, b) => Number(b.evidence?.verifiedCount || 0) - Number(a.evidence?.verifiedCount || 0))
        .slice(0, 80);
    protocol.evolvedRules = evolvedRules;
    return { protocol, changed: true, evolvedRules };
}

export function buildMakerRepairEvolutionGuidance(protocol, tasks = []) {
    const taskSources = new Set((Array.isArray(tasks) ? tasks : []).map((task) => task.source).filter(Boolean));
    const taskTemplates = new Set((Array.isArray(tasks) ? tasks : []).map((task) => task.templateId).filter(Boolean));
    return (Array.isArray(protocol?.evolvedRules) ? protocol.evolvedRules : [])
        .filter((rule) => {
            const sourceMatch = !rule.source || taskSources.has(rule.source);
            const templateMatch = !rule.templateId || taskTemplates.has(rule.templateId);
            return sourceMatch && templateMatch;
        })
        .sort((a, b) => Number(b.evidence?.verifiedCount || 0) - Number(a.evidence?.verifiedCount || 0))
        .slice(0, 6)
        .map((rule) => ({
            id: rule.id,
            source: rule.source,
            templateId: rule.templateId,
            repairTask: rule.repairTask,
            confidence: rule.confidence,
            evidence: rule.evidence,
            guidance: rule.guidance,
            likelyFiles: rule.likelyFiles,
        }));
}

export function formatMakerRepairEvolutionPromptBlock(evolutionGuidance = []) {
    if (!Array.isArray(evolutionGuidance) || evolutionGuidance.length === 0) {
        return [
            'Maker evolved repair rules:',
            'No broader repeated-failure rule matched this repair yet.',
        ].join('\n');
    }
    return [
        'Maker evolved repair rules:',
        'These are broader rules learned from repeated maker repair history. Apply them before improvising.',
        JSON.stringify(evolutionGuidance, null, 2),
        '',
        'Evolution policy:',
        '- Evolved rules are not cosmetic advice; they are prior verified failure pressure.',
        '- If an evolved rule names likely files, inspect those files first and keep changes focused.',
        '- If an exact repair memory and an evolved rule both apply, satisfy both unless they conflict with current project code.',
    ].join('\n');
}

// ── Record outcome to PostgreSQL ──────────────────────────────────────

export async function recordMakerRepairOutcome(_rootDir, {
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
    await ensureRepairProtocolSchema();
    const signatures = buildMakerRepairSignatures(tasks);
    const timestamp = nowIso();

    try {
        for (const signature of signatures) {
            // Upsert each signature entry
            const existingRes = await pool.query(
                `SELECT * FROM maker_repair_entries WHERE id = $1`, [signature.id]
            );

            if (existingRes.rows.length === 0) {
                // Insert new entry
                const recipeTitles = Array.isArray(playbook?.recipes)
                    ? playbook.recipes.map((r) => r?.title).filter(Boolean)
                    : [];
                const hints = [...recipeTitles, ...(Array.isArray(repairNotes) ? repairNotes : [])].filter(Boolean).slice(0, 12);
                
                await pool.query(
                    `INSERT INTO maker_repair_entries 
                     (id, source, template_id, failure_pattern, repair_task, raw_failures, repair_hints, templates, successful_examples, seen_count, verified_count, failed_count, created_at, updated_at, last_seen_at, last_verified_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, $13, $14)`,
                    [
                        signature.id,
                        signature.source,
                        signature.templateId || templateId || null,
                        signature.failurePattern,
                        signature.directRepairTask,
                        JSON.stringify(signature.rawFailure ? [signature.rawFailure] : []),
                        JSON.stringify(hints),
                        JSON.stringify(templateId ? [templateId] : []),
                        JSON.stringify(verified ? [{
                            jobId, attempt,
                            repairNotes: (Array.isArray(repairNotes) ? repairNotes : []).slice(0, 6),
                            appliedFiles: (Array.isArray(applied) ? applied : []).map(f => f?.path || f).filter(Boolean),
                            verifiedAt: timestamp,
                        }] : []),
                        1, // seen_count
                        verified ? 1 : 0,
                        verified ? 0 : 1,
                        timestamp,
                        verified ? timestamp : null,
                    ]
                );
            } else {
                // Update existing entry
                const row = existingRes.rows[0];
                const rawFailures = row.raw_failures || [];
                if (signature.rawFailure && !rawFailures.includes(signature.rawFailure)) {
                    rawFailures.push(signature.rawFailure);
                    while (rawFailures.length > 8) rawFailures.shift();
                }

                const hints = row.repair_hints || [];
                const recipeTitles = Array.isArray(playbook?.recipes)
                    ? playbook.recipes.map((r) => r?.title).filter(Boolean)
                    : [];
                for (const hint of [...recipeTitles, ...(Array.isArray(repairNotes) ? repairNotes : [])].filter(Boolean)) {
                    if (!hints.includes(hint)) hints.push(hint);
                }
                while (hints.length > 12) hints.shift();

                const templates = row.templates || [];
                if (templateId && !templates.includes(templateId)) {
                    templates.push(templateId);
                }

                const successfulExamples = row.successful_examples || [];
                if (verified) {
                    successfulExamples.push({
                        jobId, attempt,
                        repairNotes: (Array.isArray(repairNotes) ? repairNotes : []).slice(0, 6),
                        appliedFiles: (Array.isArray(applied) ? applied : []).map(f => f?.path || f).filter(Boolean),
                        verifiedAt: timestamp,
                    });
                    while (successfulExamples.length > 5) successfulExamples.shift();
                }

                await pool.query(
                    `UPDATE maker_repair_entries SET
                        seen_count = seen_count + 1,
                        verified_count = verified_count + $1,
                        failed_count = failed_count + $2,
                        raw_failures = $3,
                        repair_hints = $4,
                        templates = $5,
                        successful_examples = $6,
                        last_seen_at = $7,
                        last_verified_at = COALESCE($8, last_verified_at),
                        updated_at = $7
                     WHERE id = $9`,
                    [
                        verified ? 1 : 0,
                        verified ? 0 : 1,
                        JSON.stringify(rawFailures),
                        JSON.stringify(hints),
                        JSON.stringify(templates),
                        JSON.stringify(successfulExamples),
                        timestamp,
                        verified ? timestamp : null,
                        signature.id,
                    ]
                );
            }
        }

        // Record history
        await pool.query(
            `INSERT INTO maker_repair_history (job_id, attempt, template_id, verified, failure, signature_ids, applied_files)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                jobId,
                attempt,
                templateId,
                Boolean(verified),
                failure,
                JSON.stringify(signatures.map(s => s.id)),
                JSON.stringify((Array.isArray(applied) ? applied : []).map(f => f?.path || f).filter(Boolean)),
            ]
        );

        // Trim old history (keep last 500)
        await pool.query(
            `DELETE FROM maker_repair_history WHERE id NOT IN (
                SELECT id FROM maker_repair_history ORDER BY created_at DESC LIMIT 500
            )`
        ).catch(() => {});

        console.log(`🧠 [Repair Memory] Recorded ${verified ? '✅ VERIFIED' : '❌ FAILED'} outcome for ${signatures.length} signature(s) [job=${jobId}]`);
        
        // Return a protocol-shaped object for compatibility
        return await loadMakerRepairProtocol(null);
    } catch (err) {
        console.error('[Repair Protocol] DB record failed:', err.message);
        return { version: PROTOCOL_VERSION, source: 'error', entries: [], evolvedRules: [], history: [] };
    }
}
