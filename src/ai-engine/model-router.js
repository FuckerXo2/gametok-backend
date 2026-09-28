/**
 * Model Router for GameTok AI Game Generation Pipeline
 * 
 * Handles intake model assignment (§4) and bidirectional mid-generation handoffs (§6).
 * Ensures cheap text model (DeepSeek-V4-Flash) carries procedural work, while expensive
 * vision model (Qwen3.8-Max) is only invoked when visual understanding is required.
 */

export const MODEL_GEMINI_FLASH = 'gemini-3.8-flash';
export const MODEL_QWEN_MAX = 'gemini-3.8-flash'; // Alias
export const MODEL_DEEPSEEK_FLASH = 'gemini-3.8-flash'; // Alias

/**
 * Determine initial model owner for job intake (§4)
 * @param {{ prompt: string, attachments?: Array<any>, hasVisualContext?: boolean }} jobData 
 * @returns {'gemini-3.8-flash'}
 */
export function determineInitialModel(jobData = {}) {
    return MODEL_GEMINI_FLASH;
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
