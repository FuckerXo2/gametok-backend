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
import { isMakerFactoryMinimalMode } from './maker-factory-mode.js';

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
    factoryMinimal = isMakerFactoryMinimalMode(),
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

    // Required-art gate. Factory-minimal mode trusts compile + sandbox and blocks only on
    // wiring (see FACTORY_MINIMAL_BLOCKING_PREFLIGHT_IDS), not on art *generation* quality —
    // the canvas-kernel stub renders code-drawn fallbacks for any missing/fallback slot, so a
    // failed FLUX slot should degrade the look, not kill an otherwise-buildable game.
    try {
        assertRequiredContractArt(generatedAssets, assetContract);
    } catch (error) {
        if (!factoryMinimal || error?.code !== 'REQUIRED_CONTRACT_ART_FAILED') throw error;
        const degraded = (error.issues || []).map((issue) => issue.key || issue.id).filter(Boolean);
        generatedAssets.requiredArtDegraded = degraded;
        errors = [...errors, { phase: 'required_contract_art', message: error.message, degradedSlots: degraded }];
        attachMakerAssetManifest(generatedAssets, { assetContract, templateContract, qualityIntent, errors });
        console.warn(`[Asset Gate] ${error.message} — factory-minimal: continuing with code-rendered fallbacks${degraded.length ? ` for ${degraded.join(', ')}` : ''}`);
    }

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
    factoryMinimal = isMakerFactoryMinimalMode(),
} = {}) {
    const requiredCount = countRequiredVisualContractSlots(assetContract);
    if (!artistWasRequired || requiredCount === 0) {
        return;
    }

    // In factory-minimal mode the canvas-kernel renderer falls back to code-drawn art for any
    // unmet visual slot, so an incomplete art pack degrades the look rather than killing the job.
    // Outside factory-minimal we still fail closed.
    const blockOrDegrade = (message, extra = {}) => {
        if (factoryMinimal) {
            console.warn(`[Asset Gate] ${message} — factory-minimal: continuing into Phase 2 with code-rendered fallbacks`);
            return;
        }
        const error = new Error(`Phase 2 blocked: ${message}`);
        error.code = PHASE2_ASSET_PACK_INCOMPLETE;
        Object.assign(error, extra);
        throw error;
    };

    if (!generatedAssets || !generatedAssets.assets || Object.keys(generatedAssets.assets).length === 0) {
        blockOrDegrade('visual assets were required for this contract but artist output is missing.');
        return;
    }

    const contractIssues = collectRequiredContractArtIssues(generatedAssets, assetContract);
    if (contractIssues.length > 0) {
        blockOrDegrade(
            `required contract art incomplete (${contractIssues.map((entry) => entry.key || entry.id).join(', ')}).`,
            { issues: contractIssues },
        );
    }

    const missing = asArray(
        generatedAssets.materializedAssetWiringReport?.missingRequiredSlots
        || generatedAssets.makerAssetManifest?.missingRequiredSlots,
    );
    if (missing.length > 0) {
        blockOrDegrade(
            `materialized asset pack missing required slots: ${missing.join(', ')}.`,
            { missingSlots: missing },
        );
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

    const wiringRepairs = projectRoot
        ? await applyMainTsAssetWiringRepairs(projectRoot, {
            allowedKeys,
            assetContract,
            generatedAssets,
        })
        : [];

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
