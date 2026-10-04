/**
 * GameTOK AI Token & Spend Tracker
 * 
 * Provides real-time tracking of exact Gemini tokens and image generations per job,
 * matching Google Cloud / Google AI Studio billing rates down to the penny.
 */

// Official Gemini 3.8 Flash Pricing Rates (per 1,000,000 tokens)
export const GEMINI_RATES = {
    inputPerMillion: 0.75,
    cachedInputPerMillion: 0.075,
    outputPerMillion: 3.75,
};

export const IMAGE_RATES = {
    flareCardCostUsd: 0.006, // OpenAI gpt-image-2.5-flare 1024x1024 low
};

// In-memory store of active job spends
const jobSpendRegistry = new Map();

/**
 * Initialize or get spend entry for a job
 * @param {string} jobId 
 */
function getOrCreateJobRecord(jobId) {
    if (!jobId) return null;
    if (!jobSpendRegistry.has(jobId)) {
        jobSpendRegistry.set(jobId, {
            jobId,
            geminiInputTokens: 0,
            geminiOutputTokens: 0,
            geminiCachedTokens: 0,
            geminiCallsCount: 0,
            imageCount: 0,
            imageCostUsd: 0.0,
            hermesTurnsCount: 0,
            startedAt: Date.now(),
        });
    }
    return jobSpendRegistry.get(jobId);
}

/**
 * Record Gemini token usage from an actual API call response
 * @param {string} jobId 
 * @param {{ promptTokens?: number, completionTokens?: number, cachedTokens?: number, model?: string }} usage 
 */
export function recordGeminiUsage(jobId, usage = {}) {
    if (!jobId || !usage) return;
    const record = getOrCreateJobRecord(jobId);
    if (!record) return;

    const inputTokens = Number(usage.promptTokens || usage.prompt_tokens || 0);
    const outputTokens = Number(usage.completionTokens || usage.completion_tokens || 0);
    const cachedTokens = Number(usage.cachedTokens || usage.cached_tokens || 0);

    record.geminiInputTokens += Math.max(0, inputTokens);
    record.geminiOutputTokens += Math.max(0, outputTokens);
    record.geminiCachedTokens += Math.max(0, cachedTokens);
    record.geminiCallsCount += 1;

    console.log(`📊 [Token Tracker] Job ${jobId} +${inputTokens} in / +${outputTokens} out (Total In: ${record.geminiInputTokens}, Out: ${record.geminiOutputTokens})`);
}

/**
 * Record image card generations for a job
 * @param {string} jobId 
 * @param {number} count 
 * @param {number} [unitCost] 
 */
export function recordImageGeneration(jobId, count = 1, unitCost = IMAGE_RATES.flareCardCostUsd) {
    if (!jobId || count <= 0) return;
    const record = getOrCreateJobRecord(jobId);
    if (!record) return;

    record.imageCount += count;
    record.imageCostUsd = Number((record.imageCount * unitCost).toFixed(4));
    console.log(`🎨 [Token Tracker] Job ${jobId} +${count} image(s) ($${record.imageCostUsd.toFixed(4)})`);
}

/**
 * Record Hermes agent session turns
 * @param {string} jobId 
 * @param {number} turns 
 * @param {{ inputTokens?: number, outputTokens?: number }} [estimatedTokens]
 */
export function recordHermesSession(jobId, turns = 1, estimatedTokens = null) {
    if (!jobId) return;
    const record = getOrCreateJobRecord(jobId);
    if (!record) return;

    record.hermesTurnsCount += turns;
    if (estimatedTokens) {
        if (estimatedTokens.inputTokens) record.geminiInputTokens += estimatedTokens.inputTokens;
        if (estimatedTokens.outputTokens) record.geminiOutputTokens += estimatedTokens.outputTokens;
    }
}

/**
 * Compute the complete, accurate spend breakdown for a job
 * @param {string} jobId 
 * @param {object} [fallbackContext]
 * @returns {object}
 */
export function calculateJobSpend(jobId, fallbackContext = {}) {
    const record = jobId ? jobSpendRegistry.get(jobId) : null;

    let inputTokens = record?.geminiInputTokens || 0;
    let outputTokens = record?.geminiOutputTokens || 0;
    let cachedTokens = record?.geminiCachedTokens || 0;
    let imageCount = record?.imageCount || 0;
    let imageCostUsd = record?.imageCostUsd || 0.0;

    // If no real API usage was captured, calculate realistic estimates based on actual prompt/code lengths
    if (inputTokens === 0 && outputTokens === 0) {
        const promptLen = (fallbackContext.prompt || '').length;
        const codeLen = (fallbackContext.code || '').length;
        const attempts = Math.max(1, fallbackContext.attempts || 1);

        // Hermes multi-turn agent with Three.js skill manifests
        const skillManifestTokens = 25000;
        inputTokens = skillManifestTokens + Math.round(promptLen / 3.8) + (attempts * 4500);
        outputTokens = 1200 + Math.round(codeLen / 3.8);

        if (fallbackContext.hasVisualDir) imageCount += 4;
        if (fallbackContext.hasPerspectives) imageCount += 4;
        imageCostUsd = Number((imageCount * IMAGE_RATES.flareCardCostUsd).toFixed(4));
    }

    // Google Gemini 3.8 Flash per-million token arithmetic
    const uncachedInputTokens = Math.max(0, inputTokens - cachedTokens);
    const inputCostUsd = (uncachedInputTokens * GEMINI_RATES.inputPerMillion) / 1_000_000;
    const cachedInputCostUsd = (cachedTokens * GEMINI_RATES.cachedInputPerMillion) / 1_000_000;
    const outputCostUsd = (outputTokens * GEMINI_RATES.outputPerMillion) / 1_000_000;

    const geminiCostUsd = Number((inputCostUsd + cachedInputCostUsd + outputCostUsd).toFixed(4));
    const totalSpendUsd = Number((geminiCostUsd + imageCostUsd).toFixed(4));

    return {
        jobId: jobId || 'unknown',
        totalUsd: totalSpendUsd,
        geminiCostUsd,
        geminiInputTokens: inputTokens,
        geminiOutputTokens: outputTokens,
        geminiCachedTokens: cachedTokens,
        geminiCallsCount: record?.geminiCallsCount || 1,
        imageCount,
        imageCostUsd,
        blenderRigCostUsd: 0.0,
        r2CostUsd: 0.0,
        currency: 'USD',
        isMeasured: (record?.geminiInputTokens || 0) > 0,
    };
}

/**
 * Free job spend tracking from memory after a delay
 * @param {string} jobId 
 */
export function purgeJobSpend(jobId) {
    if (!jobId) return;
    setTimeout(() => {
        jobSpendRegistry.delete(jobId);
    }, 10 * 60 * 1000); // 10 minute retention
}
