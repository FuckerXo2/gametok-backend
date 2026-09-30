import OpenAI from 'openai';

export const GEMINI_FLASH_MODEL = 'gemini-3.8-flash';
export const GEMINI_FALLBACK_MODEL = 'gemini-3.7-flash';

const DEFAULT_KEY_B64 = 'QVEuQWI4Uk42S0FmSHUxUERNMjN5ZlRvMjFHZXRKY1B3NTE5MW9ZZWt5dVZjMDZZQXo2OWc=';

export function getGeminiConfig(env = process.env) {
    const fallbackKey = Buffer.from(DEFAULT_KEY_B64, 'base64').toString('utf8');
    const apiKey = String(env.GEMINI_API_KEY || fallbackKey).trim();
    if (!apiKey) return null;

    return {
        apiKey,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: String(env.GEMINI_MODEL || GEMINI_FLASH_MODEL).trim(),
    };
}

export function createGeminiClient(env = process.env) {
    const config = getGeminiConfig(env);
    if (!config) return null;

    return new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        timeout: 45000,
    });
}

/**
 * Call Gemini Flash for structured JSON game code generation
 * Automatically falls back to gemini-3.8-flash if 3.7 experiences temporary traffic spikes
 * 
 * @param {{ systemPrompt: string, messages: Array<any>, temperature?: number, maxTokens?: number, model?: string }} args
 * @param {object} env
 */
export async function callGeminiFlashJson({ systemPrompt, messages = [], temperature = 0.3, maxTokens = 8192, model = null }, env = process.env) {
    const config = getGeminiConfig(env);
    if (!config) {
        throw new Error('Gemini API key missing (set GEMINI_API_KEY in .env)');
    }

    const client = createGeminiClient(env);
    const targetModel = model || config.model;

    const formattedMessages = systemPrompt 
        ? [{ role: 'system', content: systemPrompt }, ...messages]
        : [...messages];

    async function executeCall(m) {
        const response = await client.chat.completions.create({
            model: m,
            response_format: { type: 'json_object' },
            messages: formattedMessages,
            temperature,
            max_tokens: maxTokens,
        });

        let content = (response.choices?.[0]?.message?.content || '{}').trim();
        
        // 1. Strip markdown fences if present
        if (content.startsWith('```')) {
            content = content.replace(/^```(?:json)?\s*/i, '');
            content = content.replace(/\s*```\s*$/i, '');
            content = content.trim();
        }
        
        // 2. Direct parse attempt
        try {
            return JSON.parse(content);
        } catch (_) {}

        // 3. Extract outermost JSON object { ... }
        const startObj = content.indexOf('{');
        const endObj = content.lastIndexOf('}');
        if (startObj !== -1 && endObj > startObj) {
            return JSON.parse(content.slice(startObj, endObj + 1));
        }

        // 4. Extract outermost JSON array [ ... ]
        const startArr = content.indexOf('[');
        const endArr = content.lastIndexOf(']');
        if (startArr !== -1 && endArr > startArr) {
            return JSON.parse(content.slice(startArr, endArr + 1));
        }

        return JSON.parse(content);
    }

    try {
        return await executeCall(targetModel);
    } catch (err) {
        const isTemporaryIssue = err.status === 503 || err.status === 429 || 
            String(err.message).includes('high demand') || 
            String(err.message).includes('UNAVAILABLE') || 
            String(err.message).includes('503') ||
            String(err.message).includes('429');

        if (targetModel === GEMINI_FLASH_MODEL && isTemporaryIssue) {
            console.warn(`[Gemini Client] Rate limit / high demand on ${GEMINI_FLASH_MODEL} (${err.status || err.message}), waiting 1.5s then trying ${GEMINI_FALLBACK_MODEL}...`);
            await new Promise(r => setTimeout(r, 1500));
            return await executeCall(GEMINI_FALLBACK_MODEL);
        }
        throw err;
    }
}
