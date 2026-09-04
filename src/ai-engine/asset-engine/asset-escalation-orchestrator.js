import { normalizeAssetRequirement } from './asset-requirement-schema.js';
import { searchAssetCatalog } from './asset-search.js';
import { externalProviderRegistry } from './external-provider-interface.js';
import { universalAssetIngestor } from './ingestor/universal-asset-ingestor.js';
import { QuaterniusAssetProvider } from './providers/quaternius-provider.js';

// Auto-register baseline providers
if (!externalProviderRegistry.get('quaternius')) {
    externalProviderRegistry.register(new QuaterniusAssetProvider());
}

/**
 * Orchestrator-Owned Asset Lifecycle Escalation Manager
 * 
 * Deterministically guides the resolution of an entity's asset requirement:
 * Local Catalog -> Deterministic Filter -> Qwen Visual Eval -> Refine Query -> External Discovery -> Ingest -> Fallback
 * 
 * @param {object} rawRequirement 
 * @param {object} [context]
 * @param {function} [context.visualEvaluator] Optional Qwen visual evaluation callback
 * @returns {Promise<{ status: 'selected' | 'procedural_fallback', asset?: object, reason: string }>}
 */
export async function resolveComponentAsset(rawRequirement, context = {}) {
    const requirement = normalizeAssetRequirement(rawRequirement);
    console.log(`🔍 [Asset Escalation] Resolving asset for component "${requirement.component_id}": "${requirement.concept}" (Rig: ${requirement.rig_type})`);

    // Step 1: Query Local Catalog
    let localCandidates = await searchAssetCatalog({
        query: requirement.concept,
        category: requirement.category,
        rig_type: requirement.rig_type !== 'unrigged' ? requirement.rig_type : undefined,
        style: requirement.style,
        requires_animations: requirement.required_capabilities.length > 0
    });

    // Step 2: Evaluate Local Candidates
    if (localCandidates.length > 0) {
        const selected = await evaluateCandidates(localCandidates, requirement, context.visualEvaluator);
        if (selected) {
            console.log(`✅ [Asset Escalation] Local catalog match accepted: "${selected.name}" (${selected.id})`);
            return { status: 'selected', asset: selected, source: 'local_catalog', reason: 'Local catalog match accepted' };
        }
        console.log(`⚠️ [Asset Escalation] Local candidates rejected by visual/style evaluation. Attempting query refinement...`);
    }

    // Step 3: Refine Local Query (Try broader category / concept tags)
    if (requirement.visual_preferences.length > 0) {
        for (const pref of requirement.visual_preferences) {
            const refinedCandidates = await searchAssetCatalog({
                query: `${requirement.concept} ${pref}`,
                rig_type: requirement.rig_type !== 'unrigged' ? requirement.rig_type : undefined
            });
            if (refinedCandidates.length > 0) {
                const selected = await evaluateCandidates(refinedCandidates, requirement, context.visualEvaluator);
                if (selected) {
                    console.log(`✅ [Asset Escalation] Refined local match accepted: "${selected.name}" (${selected.id})`);
                    return { status: 'selected', asset: selected, source: 'local_catalog_refined', reason: 'Refined local match accepted' };
                }
            }
        }
    }

    // Step 4: Escalate to External Discovery Providers
    console.log(`🌐 [Asset Escalation] Local catalog exhausted. Escalating to external discovery providers...`);
    const providers = externalProviderRegistry.getAll();

    for (const provider of providers) {
        try {
            const externalCandidates = await provider.search(requirement);
            if (externalCandidates && externalCandidates.length > 0) {
                console.log(`🎯 [Asset Escalation] Provider "${provider.name}" found ${externalCandidates.length} candidate(s). Ingesting top candidate...`);
                const topCandidate = externalCandidates[0];

                // Universal Ingestion via UniversalAssetIngestor (Format-Agnostic + Real R2 Upload)
                const binaryData = await provider.fetchBinary(topCandidate.externalId, topCandidate.downloadUrl);
                const ingested = await universalAssetIngestor.ingest({
                    buffer: binaryData.buffer,
                    filename: `${topCandidate.externalId}.${binaryData.format || 'glb'}`,
                    sourceFormat: binaryData.format || 'glb',
                    name: topCandidate.name,
                    category: requirement.category,
                    subcategory: requirement.subcategory,
                    style: requirement.style,
                    tags: topCandidate.tags || [requirement.concept],
                    source: provider.id,
                    license: topCandidate.license || 'CC0',
                    attribution: `${topCandidate.author || provider.name} (${topCandidate.license || 'CC0'})`,
                    thumbnailUrl: topCandidate.previewUrl || null
                });

                console.log(`🎉 [Asset Escalation] Successfully ingested & stored external asset: "${ingested.name}" (ID: ${ingested.id})`);
                return { status: 'selected', asset: ingested, source: 'external_ingested', reason: `Discovered and ingested from ${provider.name}` };
            }
        } catch (providerErr) {
            console.warn(`⚠️ [Asset Escalation] Provider "${provider.name}" search/ingest failed:`, providerErr.message);
        }
    }

    // Step 5: Procedural Fallback
    console.log(`🛠️ [Asset Escalation] No asset match found. Recommending procedural synthesis for "${requirement.concept}".`);
    return {
        status: 'procedural_fallback',
        component_id: requirement.component_id,
        concept: requirement.concept,
        reason: 'No suitable library or external asset available. Synthesize entity procedurally using Three.js primitives/shaders.'
    };
}


async function evaluateCandidates(candidates, requirement, visualEvaluator) {
    if (!candidates || candidates.length === 0) return null;

    // Use custom or Qwen multimodal visual evaluator if available
    try {
        if (typeof visualEvaluator === 'function') {
            const decision = await visualEvaluator(candidates, requirement);
            if (decision && decision.selectedId) {
                return candidates.find(c => c.id === decision.selectedId) || null;
            }
        } else if (candidates.some(c => c.thumbnail_url)) {
            const { QwenAssetEvaluator } = await import('./visual/qwen-asset-evaluator.js');
            const decision = await QwenAssetEvaluator.evaluateCandidates(candidates, requirement);
            if (decision && decision.selectedId) {
                return candidates.find(c => c.id === decision.selectedId) || null;
            }
        }
    } catch (evalErr) {
        console.warn(`⚠️ [Asset Escalation] Visual evaluation fallback: ${evalErr.message}`);
    }

    // Deterministic fallback: return first candidate matching rig constraints
    return candidates[0];
}

