/**
 * Model Router for GameTok AI Game Generation Pipeline
 * 
 * Handles intake model assignment (§4) and bidirectional mid-generation handoffs (§6).
 * Ensures cheap text model (DeepSeek-V4-Flash) carries procedural work, while expensive
 * vision model (Qwen3.8-Max) is only invoked when visual understanding is required.
 */

export const MODEL_DEEPSEEK_FLASH = 'deepseek-v4-flash';
export const MODEL_QWEN_MAX = 'qwen3.8-max';

/**
 * Determine initial model owner for job intake (§4)
 * @param {{ prompt: string, attachments?: Array<any>, hasVisualContext?: boolean }} jobData 
 * @returns {'deepseek-v4-flash' | 'qwen3.8-max'}
 */
export function determineInitialModel(jobData = {}) {
    const attachments = Array.isArray(jobData.attachments) ? jobData.attachments : [];
    const hasAttachments = attachments.length > 0;
    const hasVisualContext = Boolean(jobData.hasVisualContext || jobData.imageUrl || jobData.videoUrl);

    if (hasAttachments || hasVisualContext) {
        return MODEL_QWEN_MAX;
    }

    return MODEL_DEEPSEEK_FLASH;
}

/**
 * Evaluate whether mid-generation handoff should occur (§6)
 * @param {import('./shared-game-state.js').SharedGameState} gameState 
 * @param {{ type: string, payload?: any }} triggerEvent 
 * @returns {{ shouldHandoff: boolean, targetModel?: string, reason?: string }}
 */
export function evaluateMidLoopHandoff(gameState, triggerEvent = {}) {
    const currentModel = gameState.currentModelOwner;

    // Trigger: DeepSeek -> Qwen
    if (currentModel === MODEL_DEEPSEEK_FLASH) {
        if (triggerEvent.type === 'NEW_VISUAL_ATTACHMENT' || (triggerEvent.attachments && triggerEvent.attachments.length > 0)) {
            return {
                shouldHandoff: true,
                targetModel: MODEL_QWEN_MAX,
                reason: 'New visual attachment added mid-generation'
            };
        }
        if (triggerEvent.type === 'REQUEST_VISION_CHECK') {
            return {
                shouldHandoff: true,
                targetModel: MODEL_QWEN_MAX,
                reason: triggerEvent.payload?.reason || 'DeepSeek requested vision verification for asset/style alignment'
            };
        }
    }

    // Trigger: Qwen -> DeepSeek
    if (currentModel === MODEL_QWEN_MAX) {
        if (triggerEvent.type === 'VISUAL_PROCESSING_COMPLETE') {
            return {
                shouldHandoff: true,
                targetModel: MODEL_DEEPSEEK_FLASH,
                reason: 'Visual reference processing complete; handing off remaining logic/math to DeepSeek-V4-Flash'
            };
        }
    }

    return { shouldHandoff: false };
}
