import fs from 'fs/promises';
import { execSync } from 'child_process';

export function parseTscOutput(rawOutput = '') {
    return String(rawOutput || '')
        .split('\n')
        .filter((line) => /^src\/.*\(\d+,\d+\):\s*error\s+TS\d+/.test(line) || /^error\s+TS\d+/.test(line))
        .slice(0, 15);
}

export function createTscFailedError(rawOutput = '') {
    const tsErrors = parseTscOutput(rawOutput);
    const buildError = new Error(
        `[Vite Build] TypeScript compilation failed with ${tsErrors.length} error(s):\n${tsErrors.join('\n')}`
    );
    buildError.code = 'TSC_FAILED';
    buildError.buildErrors = tsErrors;
    buildError.rawOutput = String(rawOutput || '').slice(0, 4000);
    return buildError;
}

export async function runMakerProjectTscCheck(projectRoot, { timeoutMs = 60_000 } = {}) {
    try {
        execSync('npx tsc --noEmit', { cwd: projectRoot, stdio: 'pipe', timeout: timeoutMs });
        return { ok: true };
    } catch (tscError) {
        const stderr = tscError.stderr?.toString?.() || '';
        const stdout = tscError.stdout?.toString?.() || '';
        throw createTscFailedError(`${stdout}\n${stderr}`.trim());
    }
}

export async function restoreMakerFileBackups(backups = new Map()) {
    for (const [absolutePath, content] of backups.entries()) {
        if (content === null) {
            await fs.unlink(absolutePath).catch(() => {});
            continue;
        }
        await fs.writeFile(absolutePath, content, 'utf8');
    }
}

export function buildMakerCompileFailureEvidence(error, { phase = 'after_file_agent_turn', turnNumber = null } = {}) {
    const tsErrors = Array.isArray(error?.buildErrors) ? error.buildErrors : [];
    return {
        phase,
        success: false,
        crashes: tsErrors.length > 0
            ? tsErrors.map((entry) => `BUILD ERROR: ${entry}`)
            : [error?.message || 'TypeScript compilation failed'],
        diagnostics: {
            buildFailure: {
                type: error?.code || 'TSC_FAILED',
                errors: tsErrors,
                rawOutput: error?.rawOutput || null,
                rejectedEdits: true,
            },
            failedContractChecks: [{
                id: 'build_compilation_failed',
                message: 'Proposed file edits were rejected because they do not compile. Fix every TypeScript error before resubmitting.',
            }],
        },
        targetedRepairTasks: tsErrors.slice(0, 8).map((entry) => ({
            task: 'fix_build_error',
            description: entry,
            severity: 'critical',
        })),
        turnNumber,
    };
}

export function buildMakerPatchFailureEvidence(error, { phase = 'after_file_agent_turn', turnNumber = null } = {}) {
    const message = error?.message || 'Maker patch anchors could not be applied.';
    return {
        phase,
        success: false,
        crashes: [`PATCH ERROR: ${message}`],
        diagnostics: {
            patchFailure: {
                type: 'MAKER_PATCH_APPLY_FAILED',
                message,
                rejectedEdits: true,
            },
            failedContractChecks: [{
                id: 'patch_anchor_not_found',
                message: 'Proposed find/replace anchors did not match the current source. Copy exact text from the project files.',
            }],
        },
        targetedRepairTasks: [{
            task: 'fix_patch_anchor',
            description: message,
            severity: 'critical',
        }],
        turnNumber,
    };
}

export function buildMakerDecodeFailureEvidence(error, { phase = 'after_file_agent_turn', turnNumber = null } = {}) {
    const message = error?.message || 'Maker file payload could not be decoded.';
    return {
        phase,
        success: false,
        crashes: [`DECODE ERROR: ${message}`],
        diagnostics: {
            decodeFailure: {
                type: 'MAKER_FILE_DECODE_FAILED',
                message,
                rejectedEdits: true,
            },
            failedContractChecks: [{
                id: 'file_payload_decode_failed',
                message: 'Proposed file edits were rejected because base64 content could not be decoded into valid UTF-8 source. Re-encode UTF-8 only.',
            }],
        },
        targetedRepairTasks: [{
            task: 'fix_file_payload',
            description: message,
            severity: 'critical',
        }],
        turnNumber,
    };
}
