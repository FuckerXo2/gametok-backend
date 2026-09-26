/**
 * Model Router for GameTok AI Game Generation Pipeline
 * 
 * Handles intake model assignment (§4) and bidirectional mid-generation handoffs (§6).
 * Ensures cheap text model (DeepSeek-V4-Flash) carries procedural work, while expensive
 * vision model (Qwen3.8-Max) is only invoked when visual understanding is required.
 */

export const MODEL_QWEN_MAX = 'qwen3.8-max';
export const MODEL_DEEPSEEK_FLASH = 'qwen3.8-max'; // Alias for backwards-compat

/**
 * Determine initial model owner for job intake (§4)
 * @param {{ prompt: string, attachments?: Array<any>, hasVisualContext?: boolean }} jobData 
 * @returns {'qwen3.8-max'}
 */
export function determineInitialModel(jobData = {}) {
    return MODEL_QWEN_MAX;
}

/**
 * Evaluate whether mid-generation handoff should occur (§6)
 * @param {import('./shared-game-state.js').SharedGameState} gameState 
 * @param {{ type: string, payload?: any }} triggerEvent 
 * @returns {{ shouldHandoff: boolean, targetModel?: string, reason?: string }}
 */
export function evaluateMidLoopHandoff(gameState, triggerEvent = {}) {
    // Single-model Hermes architecture: Qwen carries both text and multimodal tasks
    return { shouldHandoff: false };
}
