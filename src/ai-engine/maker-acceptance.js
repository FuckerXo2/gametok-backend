import { isBlockingAssetQualityIssue } from './maker-asset-quality.js';

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function clampScore(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function failedContractChecks(sandbox = null) {
    return asArray(sandbox?.diagnostics?.failedContractChecks);
}

function hasFailedCheck(sandbox = null, id) {
    return failedContractChecks(sandbox).some((check) => check?.id === id);
}

function scoreRuntimeProbe(sandbox = null, templateContract = null) {
    const probe = sandbox?.diagnostics?.templateRuntimeProbe || null;
    if (!probe) {
        if (asArray(templateContract?.requiredProbeApi).length === 0) {
            return {
                score: 28,
                passed: true,
                evidence: 'Template has no runtime probe API requirement; acceptance relies on sandbox, viewport, debug, and source contract checks.',
                failures: [],
            };
        }
        return {
            score: 0,
            passed: false,
            evidence: 'No template runtime probe was found.',
            failures: ['Template runtime probe missing.'],
        };
    }
    if (probe.success) {
        return {
            score: 35,
            passed: true,
            evidence: 'Template runtime probe passed live gameplay checks.',
            failures: [],
            details: probe.details || null,
        };
    }
    return {
        score: 0,
        passed: false,
        evidence: 'Template runtime probe failed.',
        failures: asArray(probe.failures),
        details: probe.details || null,
    };
}

function scoreViewport(sandbox = null) {
    const diagnostics = sandbox?.diagnostics || {};
    const issues = [
        ...(asArray(diagnostics.canvasIssues).map((issue) => `canvas#${issue.index} sizing issue`)),
        ...(asArray(diagnostics.visibleOutOfBoundsElements).map((item) => `${item.tag || 'element'} out of bounds`)),
    ];
    if (Number(diagnostics.horizontalOverflow || 0) > 4) {
        issues.push(`horizontal overflow ${diagnostics.horizontalOverflow}px`);
    }
    return {
        score: issues.length === 0 ? 10 : 0,
        passed: issues.length === 0,
        evidence: issues.length === 0 ? 'Mobile viewport checks passed.' : issues.join('; '),
        failures: issues,
    };
}

function scoreAssets(sandbox = null, assetContract = null, assetManifest = null, assetQuality = null) {
    const requiredSlots = asArray(assetContract?.slots).filter((slot) => slot?.required);
    const hasGeneratedRequiredAssets = requiredSlots.some((slot) =>
        asArray(assetManifest?.slots).some((entry) => entry?.id === slot.id && entry?.status !== 'missing')
    );
    if (!hasGeneratedRequiredAssets) {
        return {
            score: 10,
            passed: true,
            evidence: 'No generated required asset slots were available, so code fallback art is acceptable.',
            failures: [],
        };
    }
    const inspection = sandbox?.diagnostics?.assetContractInspection || null;
    const failures = [];
    if (inspection?.usesImageUi) {
        failures.push('Generated images are used for HUD/UI.');
    }
    if (asArray(inspection?.missingRoleReferences).length > 0) {
        failures.push(`Required asset slots not referenced: ${inspection.missingRoleReferences.join(', ')}`);
    }
    if (hasFailedCheck(sandbox, 'asset_pack_ignored')) {
        failures.push('Generated asset pack ignored.');
    }
    if (hasFailedCheck(sandbox, 'asset_required_roles_unused') || hasFailedCheck(sandbox, 'asset_required_slots_unreferenced')) {
        failures.push('Required generated asset roles are unused.');
    }
    if (hasFailedCheck(sandbox, 'asset_animations_unused')) {
        failures.push('Generated animation frames are unused.');
    }
    if (hasFailedCheck(sandbox, 'asset_tilesets_unused')) {
        failures.push('Generated tilesets are unused.');
    }
    if (assetQuality && assetQuality.passed === false) {
        const fatalIssues = asArray(assetQuality.issues).filter(isBlockingAssetQualityIssue);
        if (fatalIssues.length > 0) {
            failures.push(`Generated asset quality failed: ${fatalIssues.map((entry) => entry.message || entry.id).slice(0, 3).join('; ')}`);
        }
    }
    return {
        score: failures.length === 0 ? 10 : 0,
        passed: failures.length === 0,
        evidence: failures.length === 0 ? 'Generated asset contract passed.' : failures.join('; '),
        failures,
    };
}

function scoreDebugChecks(sandbox = null, debugProtocol = null) {
    const failed = failedContractChecks(sandbox);
    const checks = asArray(debugProtocol?.checks);
    const fatalFailures = [];
    const majorFailures = [];
    const results = checks.map((check) => {
        const matchingFailure = failed.find((item) => item?.id === check.id);
        const passed = !matchingFailure;
        if (!passed && check.severity === 'fatal') fatalFailures.push(matchingFailure.message || check.check || check.id);
        if (!passed && check.severity !== 'fatal') majorFailures.push(matchingFailure.message || check.check || check.id);
        return {
            id: check.id,
            severity: check.severity || 'major',
            passed,
            check: check.check,
            repair: check.repair,
            failure: matchingFailure?.message || null,
        };
    });
    const penalty = (fatalFailures.length * 12) + (majorFailures.length * 6);
    return {
        score: clampScore(25 - penalty),
        passed: fatalFailures.length === 0 && majorFailures.length === 0,
        evidence: failed.length === 0 ? 'Debug protocol checks have no reported failures.' : `${failed.length} debug/contract failures reported.`,
        failures: [...fatalFailures, ...majorFailures],
        checks: results,
    };
}

export function buildMakerAcceptanceResult({
    sandbox = null,
    templateContract = null,
    debugProtocol = null,
    assetContract = null,
    assetManifest = null,
    assetQuality = null,
    gddCompliance = null,
} = {}) {
    const runtime = scoreRuntimeProbe(sandbox, templateContract);
    const viewport = scoreViewport(sandbox);
    const assets = scoreAssets(sandbox, assetContract, assetManifest, assetQuality);
    const debug = scoreDebugChecks(sandbox, debugProtocol);
    const sandboxBoot = sandbox?.success ? 20 : 0;
    const gddScore = gddCompliance ? Math.round((Number(gddCompliance.score || 0) / 100) * 10) : 0;
    const score = clampScore(sandboxBoot + runtime.score + viewport.score + assets.score + debug.score + gddScore);
    const acceptanceChecks = asArray(templateContract?.acceptanceChecks).map((check, index) => ({
        id: `acceptance_${String(index + 1).padStart(2, '0')}`,
        check,
        passed: runtime.passed && sandbox?.success,
        evidence: runtime.passed ? 'Covered by template runtime probe.' : 'Template runtime probe did not prove this acceptance check.',
    }));
    const blockers = [
        ...(!sandbox?.success ? asArray(sandbox?.crashes).slice(0, 4) : []),
        ...runtime.failures,
        ...viewport.failures,
        ...assets.failures,
        ...debug.failures,
    ].filter(Boolean);
    if (gddCompliance && ['weak', 'fail'].includes(gddCompliance.grade)) {
        blockers.push(...asArray(gddCompliance.blockers).slice(0, 3));
    }
    const fatalBlockers = [
        ...(!sandbox?.success ? ['Sandbox did not pass.'] : []),
        ...(!runtime.passed ? ['Template runtime probe did not pass.'] : []),
        ...(!viewport.passed ? ['Mobile viewport did not pass.'] : []),
    ];
    const grade = score >= 90 ? 'pass'
        : score >= 75 ? 'watch'
        : score >= 55 ? 'weak'
        : 'fail';
    const passed = score >= 85 && fatalBlockers.length === 0 && debug.score >= 18 && assets.passed;
    const assetQualityChecks = assetQuality?.passed === false
        ? asArray(assetQuality.issues)
            .filter((entry) => entry?.severity === 'fatal')
            .slice(0, 8)
            .map((entry) => ({
                id: entry.id || 'asset_quality_failed',
                templateId: templateContract?.templateId || null,
                assetKey: entry.key || null,
                message: entry.message || 'Generated asset quality failed.',
                details: entry.details || null,
            }))
        : [];
    const failedContractChecksForRepair = passed ? [] : [
        {
            id: 'acceptance_gate',
            templateId: templateContract?.templateId || null,
            message: `Acceptance gate ${grade}: ${blockers.slice(0, 5).join(' ') || 'core playability was not proven.'}`,
            failures: blockers,
        },
        ...assetQualityChecks,
    ];
    return {
        version: 1,
        source: 'gametok-maker-acceptance-result',
        templateId: templateContract?.templateId || null,
        passed,
        grade,
        score,
        components: {
            sandboxBoot,
            runtimeProbe: runtime.score,
            viewport: viewport.score,
            assetContract: assets.score,
            debugProtocol: debug.score,
            gdd: gddScore,
        },
        blockers: [...new Set(blockers)],
        fatalBlockers: [...new Set(fatalBlockers)],
        acceptanceChecks,
        debugChecks: debug.checks,
        evidence: {
            runtime: runtime.evidence,
            viewport: viewport.evidence,
            assets: assets.evidence,
            debug: debug.evidence,
            assetQuality: assetQuality ? {
                passed: assetQuality.passed,
                score: assetQuality.score,
                counts: assetQuality.counts,
            } : null,
        },
        failedContractChecksForRepair,
    };
}

export function mergeAcceptanceIntoSandboxDiagnostics(sandbox = null, acceptance = null) {
    if (!acceptance || acceptance.passed) return sandbox;
    return {
        ...(sandbox || {}),
        diagnostics: {
            ...((sandbox && sandbox.diagnostics) || {}),
            acceptanceResult: acceptance,
            failedContractChecks: [
                ...failedContractChecks(sandbox),
                ...asArray(acceptance.failedContractChecksForRepair),
            ],
        },
        crashes: [
            ...asArray(sandbox?.crashes),
            `Acceptance gate failed: ${acceptance.grade} (${acceptance.score}/100). ${acceptance.blockers.slice(0, 4).join(' ')}`,
        ],
        success: false,
    };
}
