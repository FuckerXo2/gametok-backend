import { collectRequiredContractArtIssues } from './maker-asset-quality.js';
import { generateOneBatchAsset, normalizeBatchState } from './sprite-generator.js';

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

/** Contract slot ids that must have real generated art (not procedural fallback). */
export function getRequiredContractSlotIds(assetContract = null) {
    const ids = new Set();
    for (const slot of asArray(assetContract?.slots)) {
        if (slot?.required === false || !slot?.id) continue;
        const role = String(slot.role || slot.category || '').toLowerCase();
        if (['sfx', 'music', 'audio', 'sound'].includes(role)) continue;
        ids.add(String(slot.id));
    }
    return ids;
}

function resolveHealRequest(assetRequests = [], slotId = '') {
    const direct = assetRequests.find((request) => request?.id === slotId || request?.key === slotId);
    if (direct) return direct;
    return assetRequests.find((request) => (
        String(request?.role || request?.category || '').toLowerCase() === String(slotId).toLowerCase()
    )) || null;
}

function snapshotForQualityCheck(batchResult = {}) {
    const batch = normalizeBatchState(batchResult);
    return {
        assetPack: batch.assetPack || [],
        assets: batch.results || batch.assets || {},
    };
}

/**
 * Retry required slots that are missing or still on procedural fallback.
 * Mutates batchResult in place; returns whether all required art healed.
 */
export async function healRequiredContractArt(batchResult, assetRequests = [], assetContract = null, options = {}) {
    const batch = normalizeBatchState(batchResult);
    const maxPasses = Math.max(1, Math.min(3, Number(
        options.maxHealPasses ?? process.env.GAMETOK_ARTIST_HEAL_PASSES ?? 2,
    )));
    const maxRetriesPerSlot = Math.max(1, Math.min(4, Number(
        options.maxRetriesPerSlot ?? process.env.GAMETOK_ARTIST_REQUIRED_RETRIES ?? 2,
    )));
    const healLog = [];

    for (let pass = 1; pass <= maxPasses; pass += 1) {
        const remainingBefore = collectRequiredContractArtIssues(
            snapshotForQualityCheck(batch),
            assetContract,
        );
        if (remainingBefore.length === 0) {
            return {
                healed: true,
                batchResult: batch,
                passes: pass - 1,
                healLog,
                remainingIssues: [],
            };
        }

        const slotIds = [...new Set(remainingBefore.map((entry) => entry.key).filter(Boolean))];
        console.warn(`[Artist Heal] Pass ${pass}/${maxPasses}: regenerating ${slotIds.join(', ')}`);

        for (const slotId of slotIds) {
            const request = resolveHealRequest(assetRequests, slotId);
            if (!request) {
                healLog.push({ pass, slotId, ok: false, skipped: 'no_matching_request' });
                continue;
            }
            const outcome = await generateOneBatchAsset(batch, request, slotId, {
                ...options,
                maxRetriesPerRequired: maxRetriesPerSlot,
                requiredSlotIds: new Set([slotId]),
            });
            healLog.push({ pass, slotId, ...outcome });
        }
    }

    const remainingIssues = collectRequiredContractArtIssues(
        snapshotForQualityCheck(batch),
        assetContract,
    );
    return {
        healed: remainingIssues.length === 0,
        batchResult: batch,
        passes: maxPasses,
        healLog,
        remainingIssues,
    };
}
