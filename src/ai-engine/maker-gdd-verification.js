function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function hasFailedCheck(sandbox = null, ids = []) {
    const checks = asArray(sandbox?.diagnostics?.failedContractChecks);
    return checks.some((check) => ids.includes(check?.id));
}

function clampScore(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function componentStatus(score, fullScore) {
    if (score >= fullScore) return 'pass';
    if (score >= Math.ceil(fullScore * 0.5)) return 'partial';
    return 'fail';
}

export function verifyMakerGddCompliance({
    gddSummary = null,
    templateContract = null,
    assetContract = null,
    assetManifest = null,
    sandbox = null,
    buildMode = null,
} = {}) {
    const runtimeProbe = sandbox?.diagnostics?.templateRuntimeProbe || null;
    const assetInspection = sandbox?.diagnostics?.assetContractInspection || null;
    const requiredSlots = asArray(assetContract?.slots).filter((slot) => slot?.required);
    const missingManifestSlots = asArray(assetManifest?.missingRequiredSlots);
    const expectedSections = [
        'hasTechnicalArchitecture',
        'hasAssetRegistry',
        'hasConfiguration',
        'hasEntityArchitecture',
        'hasLevelContent',
        'hasImplementationRoadmap',
    ];
    const presentSections = expectedSections.filter((key) => Boolean(gddSummary?.[key]));

    const components = {
        sectionCompleteness: presentSections.length === expectedSections.length ? 20 : Math.round((presentSections.length / expectedSections.length) * 20),
        technicalArchitecture: templateContract?.templateId && buildMode ? 15 : 6,
        assetRegistry: missingManifestSlots.length === 0 && !assetInspection?.usesImageUi && !hasFailedCheck(sandbox, ['asset_pack_ignored', 'asset_required_slots_unreferenced', 'asset_required_roles_unused'])
            ? 20
            : Math.max(0, 20 - (missingManifestSlots.length * 5) - (assetInspection?.usesImageUi ? 10 : 0)),
        entityArchitecture: runtimeProbe?.success === false || hasFailedCheck(sandbox, ['template_required_functions', 'template_runtime_probe'])
            ? 4
            : 20,
        levelContent: sandbox?.success ? 15 : (sandbox?.hasScreenshot ? 6 : 0),
        implementationRoadmap: sandbox?.success && asArray(sandbox?.crashes).length === 0 ? 10 : 2,
    };

    const score = clampScore(Object.values(components).reduce((sum, item) => sum + item, 0));
    const blockers = [];
    if (presentSections.length < expectedSections.length) {
        blockers.push(`GDD missing sections: ${expectedSections.filter((key) => !gddSummary?.[key]).join(', ')}`);
    }
    if (requiredSlots.length > 0 && missingManifestSlots.length > 0) {
        blockers.push(`Asset registry missing required slots: ${missingManifestSlots.join(', ')}`);
    }
    if (assetInspection?.usesImageUi) {
        blockers.push('Section 1 violated: generated images used for UI/HUD.');
    }
    if (runtimeProbe?.success === false) {
        blockers.push('Section 3 violated: template runtime probe failed.');
    }
    if (!sandbox?.success) {
        blockers.push('Section 4/5 violated: sandbox did not verify a playable artifact.');
    }

    return {
        version: 1,
        source: 'gametok-gdd-verifier',
        score,
        grade: score >= 85 ? 'pass' : score >= 70 ? 'watch' : score >= 50 ? 'weak' : 'fail',
        components: Object.fromEntries(Object.entries(components).map(([key, value]) => [
            key,
            { score: value, status: componentStatus(value, key === 'implementationRoadmap' ? 10 : key === 'technicalArchitecture' || key === 'levelContent' ? 15 : 20) },
        ])),
        expectedSections,
        presentSections,
        requiredAssetSlots: requiredSlots.map((slot) => slot.id || slot.role).filter(Boolean),
        missingRequiredAssetSlots: missingManifestSlots,
        blockers: [...new Set(blockers.filter(Boolean))],
    };
}
