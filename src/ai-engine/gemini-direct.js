/**
 * Direct Gemini API Client - No CLI, No Bullshit
 * 
 * Built from scratch with only what we actually need.
 * Baby steps: Start simple, add complexity only when required.
 * 
 * Uses Gemini's OpenAI-compatible endpoint (same as AGY does behind the scenes)
 * so we can use "gemini-3.8-flash" model names and have full token control.
 */

import OpenAI from 'openai';

// Model fallback chain (3.8 → 3.7 → 3.6 when 503/429 errors occur)
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'];

// Step 3: In-memory conversation storage
// Maps sessionId -> array of {role: 'user'|'assistant', content: string}
const conversationMemory = new Map();

/**
 * Step 1: Basic text generation
 * Step 2: Model fallback retry logic (handles 503/429 automatically)
 * Step 3: Conversation history/memory (multi-turn conversations)
 * 
 * @param {string|array} prompt - The user's message (string or multimodal content array)
 * @param {object} options - Configuration options
 * @param {string} [options.sessionId] - Session ID for conversation memory (optional)
 * @param {string} [options.systemPrompt] - System prompt to guide AI behavior (optional)
 * @param {string} [options.model] - Model to use (default: gemini-3.8-flash)
 * @param {number} [options.maxTokens] - Max output tokens (default: 65536)
 * @param {number} [options.temperature] - Creativity level (default: 0.7)
 */
export async function generateText(prompt, options = {}) {
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is required');
    }
    
    const client = new OpenAI({
        apiKey,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        timeout: 180000, // 3 minutes for big game code
    });

    const requestedModel = options.model || 'gemini-3.8-flash';
    const models = FALLBACK_MODELS.includes(requestedModel)
        ? [requestedModel, ...FALLBACK_MODELS.filter(m => m !== requestedModel)]
        : [requestedModel, ...FALLBACK_MODELS];

    // Build message array with conversation history
    const messages = [];
    
    // Add system prompt if provided
    if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
    }
    
    // Add conversation history if sessionId exists
    if (options.sessionId && conversationMemory.has(options.sessionId)) {
        const history = conversationMemory.get(options.sessionId);
        messages.push(...history);
        console.log(`💭 [Memory] Loaded ${history.length} previous messages for session ${options.sessionId}`);
    }
    
    // Add current user message (supports both string and multimodal array)
    const userMessage = typeof prompt === 'string' 
        ? { role: 'user', content: prompt }
        : { role: 'user', content: prompt }; // Already formatted as multimodal array
    
    messages.push(userMessage);

    let lastError = null;

    for (const model of models) {
        try {
            console.log(`🧠 [Gemini Direct] Trying model: ${model}`);
            
            const response = await client.chat.completions.create({
                model,
                messages,
                max_tokens: options.maxTokens || 65536,
                temperature: options.temperature || 0.7,
            });

            const text = response.choices[0]?.message?.content || '';
            
            console.log(`✅ [Gemini Direct] Success with ${model}: ${response.usage?.completion_tokens || 0} tokens generated`);
            
            // Save to conversation memory if sessionId provided
            if (options.sessionId) {
                if (!conversationMemory.has(options.sessionId)) {
                    conversationMemory.set(options.sessionId, []);
                }
                const history = conversationMemory.get(options.sessionId);
                history.push(userMessage); // Save the actual message (text or multimodal)
                history.push({ role: 'assistant', content: text });
                console.log(`💾 [Memory] Saved conversation turn (total: ${history.length} messages)`);
            }
            
            return {
                text,
                model, // Return which model actually worked
                usage: {
                    promptTokens: response.usage?.prompt_tokens || 0,
                    completionTokens: response.usage?.completion_tokens || 0,
                    totalTokens: response.usage?.total_tokens || 0,
                }
            };

        } catch (error) {
            lastError = error;
            const isRetryable = error.status === 503 || error.status === 429 ||
                String(error.message).includes('503') ||
                String(error.message).includes('429') ||
                String(error.message).includes('high demand') ||
                String(error.message).includes('UNAVAILABLE');

            if (isRetryable) {
                console.warn(`⚠️ [Gemini Direct] ${model} unavailable (${error.status || error.message}), waiting 1s before trying next model...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue; // Try next model
            }

            // Non-retryable error (400, 401, etc) - fail immediately
            throw error;
        }
    }

    // All models failed
    throw lastError;
}

/**
 * Clear conversation history for a session
 */
export function clearConversation(sessionId) {
    if (conversationMemory.has(sessionId)) {
        const count = conversationMemory.get(sessionId).length;
        conversationMemory.delete(sessionId);
        console.log(`🗑️ [Memory] Cleared ${count} messages for session ${sessionId}`);
        return true;
    }
    return false;
}

/**
 * Get conversation history for a session
 */
export function getConversationHistory(sessionId) {
    return conversationMemory.get(sessionId) || [];
}

// That's it for now. We'll add more as we need it.
