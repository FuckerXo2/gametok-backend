function clampScore(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function failedContractChecks(sandbox = null) {
    return Array.isArray(sandbox?.diagnostics?.failedContractChecks)
        ? sandbox.diagnostics.failedContractChecks
        : [];
}

function templateRuntimeProbe(sandbox = null) {
    return sandbox?.diagnostics?.templateRuntimeProbe || null;
}

function assetContractInspection(sandbox = null) {
    return sandbox?.diagnostics?.assetContractInspection || null;
}

export function scoreMakerBenchmarkResult(result = {}) {
    const sandbox = result.sandbox || {};
    const failures = failedContractChecks(sandbox);
    const runtimeProbe = templateRuntimeProbe(sandbox);
    const assetInspection = assetContractInspection(sandbox);
    const repairs = Array.isArray(result.repairs) ? result.repairs : [];
    const gddCompliance = result.gddCompliance || null;
    const expectedTemplate = result.benchmark?.templateId || null;
    const selectedTemplate = result.template?.templateId || null;

    const components = {
        completed: result.status === 'complete' ? 20 : 0,
        templateMatch: expectedTemplate && selectedTemplate
            ? (expectedTemplate === selectedTemplate ? 15 : 0)
            : 8,
        sandbox: sandbox.success ? 25 : (sandbox.hasScreenshot ? 8 : 0),
        contract: failures.length === 0 && runtimeProbe?.success !== false
            ? 20
            : Math.max(0, 20 - (failures.length * 7) - (runtimeProbe?.success === false ? 8 : 0)),
        repair: repairs.length === 0
            ? 10
            : repairs.some((repair) => /failed/i.test(String(repair.mode || ''))) ? 3 : 7,
        assetAndHud: assetInspection?.usesImageUi ? 0 : 10,
        gdd: gddCompliance ? Math.round((Number(gddCompliance.score || 0) / 100) * 10) : 0,
    };

    const score = clampScore(Object.values(components).reduce((sum, item) => sum + item, 0));
    const grade = score >= 85 ? 'pass'
        : score >= 70 ? 'watch'
        : score >= 50 ? 'weak'
        : 'fail';

    const blockers = [];
    if (result.status !== 'complete') blockers.push(result.error || 'Generation did not complete.');
    if (expectedTemplate && selectedTemplate && expectedTemplate !== selectedTemplate) {
        blockers.push(`Template mismatch: expected ${expectedTemplate}, got ${selectedTemplate}.`);
    }
    if (!sandbox.success) {
        blockers.push(...(Array.isArray(sandbox.crashes) ? sandbox.crashes.slice(0, 3) : []));
    }
    for (const check of failures.slice(0, 4)) {
        blockers.push(check.message || check.id || 'Contract check failed.');
    }
    if (assetInspection?.usesImageUi) {
        blockers.push('Generated image appears to be used for UI/HUD, which violates the maker asset contract.');
    }
    if (gddCompliance?.grade === 'fail' || gddCompliance?.grade === 'weak') {
        blockers.push(...(Array.isArray(gddCompliance.blockers) ? gddCompliance.blockers.slice(0, 3) : []));
    }

    return {
        score,
        grade,
        components,
        blockers: [...new Set(blockers.filter(Boolean))],
    };
}

export function buildMakerBenchmarkResult({
    benchmark = null,
    jobId = null,
    prompt = '',
    status = 'complete',
    error = null,
    templateContract = null,
    assetContract = null,
    debugProtocol = null,
    sandbox = null,
    repairs = [],
    buildMode = null,
    generatedAssets = null,
    gddSummary = null,
    gddCompliance = null,
    agentLoop = null,
    html = '',
} = {}) {
    const result = {
        version: 1,
        source: 'gametok-maker-benchmark-result',
        jobId,
        status,
        createdAt: new Date().toISOString(),
        benchmark: benchmark ? {
            id: benchmark.id || null,
            title: benchmark.title || null,
            templateId: benchmark.templateId || null,
            difficulty: benchmark.difficulty || null,
            acceptance: Array.isArray(benchmark.acceptance) ? benchmark.acceptance : [],
        } : null,
        promptPreview: `${String(prompt || '').slice(0, 240)}${String(prompt || '').length > 240 ? '...' : ''}`,
        template: templateContract ? {
            templateId: templateContract.templateId || null,
            archetype: templateContract.archetype || null,
            engine: templateContract.engine || null,
        } : null,
        assetContract: assetContract ? {
            templateId: assetContract.templateId || null,
            slotCount: Array.isArray(assetContract.slots) ? assetContract.slots.length : 0,
        } : null,
        debugProtocol: debugProtocol ? {
            version: debugProtocol.version || null,
            checkCount: Array.isArray(debugProtocol.checks) ? debugProtocol.checks.length : 0,
            executionOrder: Array.isArray(debugProtocol.executionOrder) ? debugProtocol.executionOrder : [],
        } : null,
        gdd: gddSummary ? {
            sections: gddSummary.sections || 0,
            gddSections: gddSummary.gddSections || 0,
            hasGddContract: Boolean(gddSummary.hasGddContract),
            hasAssetRegistry: Boolean(gddSummary.hasAssetRegistry),
            hasEntityArchitecture: Boolean(gddSummary.hasEntityArchitecture),
            hasImplementationRoadmap: Boolean(gddSummary.hasImplementationRoadmap),
        } : null,
        gddCompliance: gddCompliance || null,
        agentLoop: agentLoop || null,
        sandbox: sandbox ? {
            success: Boolean(sandbox.success),
            crashes: Array.isArray(sandbox.crashes) ? sandbox.crashes.slice(0, 8) : [],
            hasScreenshot: Boolean(sandbox.hasScreenshot),
            attempt: sandbox.attempt || null,
            checkedAt: sandbox.checkedAt || null,
            diagnostics: sandbox.diagnostics || null,
        } : null,
        repairs: Array.isArray(repairs) ? repairs.map((repair) => ({
            attempt: repair.attempt || null,
            mode: repair.mode || null,
            applied: repair.applied || null,
            error: repair.error || null,
        })) : [],
        buildMode,
        assetSummary: generatedAssets ? {
            assetCount: generatedAssets.assetCount
                || (Array.isArray(generatedAssets.assets) ? generatedAssets.assets.length : Object.keys(generatedAssets.assets || {}).length)
                || (Array.isArray(generatedAssets.assetPack) ? generatedAssets.assetPack.length : 0),
            animationCount: Array.isArray(generatedAssets.animations) ? generatedAssets.animations.length : 0,
            audioCount: Array.isArray(generatedAssets.audio?.sfx) ? generatedAssets.audio.sfx.length : 0,
        } : null,
        htmlBytes: Buffer.byteLength(String(html || ''), 'utf8'),
        error: error ? String(error) : null,
    };

    return {
        ...result,
        score: scoreMakerBenchmarkResult(result),
    };
}
