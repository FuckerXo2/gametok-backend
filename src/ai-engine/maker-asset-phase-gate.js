/**
 * Single gate for maker visual assets: finalize after artist, materialize before Phase 2,
 * fail closed if the pack is incomplete, then apply one wiring pass on the project scaffold.
 */
import fs from 'fs/promises';
import path from 'path';
import {
    analyzeMakerAssetQuality,
    assertRequiredContractArt,
    collectRequiredContractArtIssues,
    summarizeMakerAssetQuality,
} from './maker-asset-quality.js';
import { buildMakerAssetManifest } from './maker-asset-manifest.js';
import { materializeMakerAssetsForProject } from './maker-asset-materializer.js';
import {
    applyMainTsAssetWiringRepairs,
    buildAssetSlotRuntimeHints,
    collectAllowedAssetPackKeys,
    readProjectAssetPackKeys,
    writeMakerAssetKeysTs,
} from './maker-agent-asset-keys.js';

export const PHASE2_ASSET_PACK_INCOMPLETE = 'PHASE2_ASSET_PACK_INCOMPLETE';

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function attachMakerAssetManifest(generatedAssets = null, context = {}) {
    const manifest = buildMakerAssetManifest({
        generatedAssets,
        assetContract: context.assetContract || null,
        templateContract: context.templateContract || null,
        qualityIntent: context.qualityIntent || {},
        errors: context.errors || [],
    });
    if (!generatedAssets) {
        return { makerAssetManifest: manifest };
    }
    generatedAssets.makerAssetManifest = manifest;
    generatedAssets.manifest = {
        ...(generatedAssets.manifest || {}),
        makerAssetManifest: manifest,
    };
    return generatedAssets;
}

async function writeWorkspaceJson(workspace, fileName, value) {
    if (!workspace) return;
    await fs.writeFile(
        path.join(workspace, fileName),
        JSON.stringify(value, null, 2),
        'utf8',
    );
}

async function writeWorkspaceAssetArtifacts(workspace, generatedAssets = null) {
    if (!workspace || !generatedAssets) return;
    if (generatedAssets.materializedAssetPack) {
        await writeWorkspaceJson(workspace, 'asset-pack.json', generatedAssets.materializedAssetPack);
    }
    if (generatedAssets.materializedAssetWiringReport) {
        await writeWorkspaceJson(workspace, 'asset-wiring-report.json', generatedAssets.materializedAssetWiringReport);
    }
    await writeWorkspaceJson(workspace, 'animations.json', {
        version: 1,
        source: 'gametok-native-maker',
        animations: asArray(generatedAssets.animations),
    });
    await writeWorkspaceJson(workspace, 'tilesets.json', {
        version: 1,
        source: 'gametok-native-maker',
        tilesets: asArray(generatedAssets.tilesets),
    });
}

/** Write PNG/data-uri assets to disk before Phase 2 (survives project/ scaffold wipe). */
export async function materializeMakerAssetsBeforePhase2(workspace, generatedAssets = null) {
    if (!workspace || !generatedAssets) return null;
    const stagingRoot = path.join(workspace, '.asset-staging');
    await fs.rm(stagingRoot, { recursive: true, force: true });
    await fs.mkdir(path.join(stagingRoot, 'public', 'assets'), { recursive: true });
    return materializeMakerAssetsForProject(stagingRoot, generatedAssets, { workspace });
}

/**
 * Post-artist: manifest, quality report, required-art assert, early materialization, workspace artifacts.
 */
export async function finalizeMakerArtistPhase({
    workspace = null,
    generatedAssets = null,
    assetContract = null,
    templateContract = null,
    qualityIntent = {},
    errors = [],
} = {}) {
    if (!generatedAssets) {
        return { generatedAssets: null, qualityReport: null, materializeResult: null };
    }

    attachMakerAssetManifest(generatedAssets, {
        assetContract,
        templateContract,
        qualityIntent,
        errors,
    });

    const qualityReport = await analyzeMakerAssetQuality(generatedAssets, { assetContract });
    generatedAssets.assetQuality = qualityReport;
    generatedAssets.manifest = {
        ...(generatedAssets.manifest || {}),
        assetQuality: qualityReport,
    };

    if (workspace) {
        await writeWorkspaceJson(workspace, 'asset-quality-report.json', qualityReport);
        await writeWorkspaceJson(workspace, 'asset-quality-summary.json', summarizeMakerAssetQuality(qualityReport));
    }

    assertRequiredContractArt(generatedAssets, assetContract);

    const materializeResult = await materializeMakerAssetsBeforePhase2(workspace, generatedAssets);
    await writeWorkspaceAssetArtifacts(workspace, generatedAssets);

    return { generatedAssets, qualityReport, materializeResult };
}

export function countRequiredVisualContractSlots(assetContract = null) {
    return asArray(assetContract?.slots).filter((slot) => {
        if (slot?.required === false || !slot?.id) return false;
        const role = String(slot.role || slot.category || '').toLowerCase();
        return !['sfx', 'music', 'audio', 'sound'].includes(role);
    }).length;
}

/**
 * Fail closed before Phase 2 when the job required generated art but the pack is missing or incomplete.
 */
export function assertMakerAssetsReadyForPhase2({
    generatedAssets = null,
    assetContract = null,
    artistWasRequired = false,
} = {}) {
    const requiredCount = countRequiredVisualContractSlots(assetContract);
    if (!artistWasRequired || requiredCount === 0) {
        return;
    }

    if (!generatedAssets || !generatedAssets.assets || Object.keys(generatedAssets.assets).length === 0) {
        const error = new Error(
            'Phase 2 blocked: visual assets were required for this contract but artist output is missing.',
        );
        error.code = PHASE2_ASSET_PACK_INCOMPLETE;
        throw error;
    }

    const contractIssues = collectRequiredContractArtIssues(generatedAssets, assetContract);
    if (contractIssues.length > 0) {
        const error = new Error(
            `Phase 2 blocked: required contract art incomplete (${contractIssues.map((entry) => entry.key || entry.id).join(', ')}).`,
        );
        error.code = PHASE2_ASSET_PACK_INCOMPLETE;
        error.issues = contractIssues;
        throw error;
    }

    const missing = asArray(
        generatedAssets.materializedAssetWiringReport?.missingRequiredSlots
        || generatedAssets.makerAssetManifest?.missingRequiredSlots,
    );
    if (missing.length > 0) {
        const error = new Error(
            `Phase 2 blocked: materialized asset pack missing required slots: ${missing.join(', ')}.`,
        );
        error.code = PHASE2_ASSET_PACK_INCOMPLETE;
        error.missingSlots = missing;
        throw error;
    }
}

/**
 * One wiring module for Phase 2: assetKeys.ts + deterministic main.ts contract wiring.
 */
export async function preparePhase2ProjectAssets({
    projectRoot = null,
    generatedAssets = null,
    assetContract = null,
    jobId = null,
} = {}) {
    const allowedKeys = [...new Set([
        ...await readProjectAssetPackKeys(projectRoot),
        ...collectAllowedAssetPackKeys({ generatedAssets }),
    ])].sort();
    const slotHints = buildAssetSlotRuntimeHints({ assetContract, generatedAssets });

    let assetKeysManifest = null;
    if (projectRoot && allowedKeys.length > 0) {
        assetKeysManifest = await writeMakerAssetKeysTs(projectRoot, {
            allowedKeys,
            slotHints,
        });
        if (jobId) {
            console.log(
                `📦 [Phase 2 job=${jobId}] Wrote ${assetKeysManifest.path}`
                + ` (${assetKeysManifest.keyCount} runtime keys, ${slotHints.length} contract slots)`,
            );
        }
    }

    let wiringRepairs = [];
    if (projectRoot) {
        let mainSource = '';
        try {
            mainSource = await fs.readFile(path.join(projectRoot, 'src', 'main.ts'), 'utf8');
        } catch {
            mainSource = '';
        }
        const isPhaserProject = /from\s+['"]phaser['"]/i.test(mainSource)
            || /new\s+Phaser\.Game/i.test(mainSource);
        if (!isPhaserProject) {
            wiringRepairs = await applyMainTsAssetWiringRepairs(projectRoot, {
                allowedKeys,
                assetContract,
                generatedAssets,
            });
        } else if (jobId) {
            console.log(`📦 [Phase 2 job=${jobId}] Phaser scaffold — skipping canvas main.ts wiring injectors`);
        }
    }

    if (jobId && wiringRepairs.length > 0) {
        console.log(
            `📦 [Phase 2 job=${jobId}] Shift-left asset wiring: ${wiringRepairs[0]?.repairs?.join(', ') || 'ok'}`,
        );
    }

    return {
        allowedKeys,
        slotHints,
        assetKeysManifest,
        wiringRepairs,
    };
}
