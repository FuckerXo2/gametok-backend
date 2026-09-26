import OpenAI from 'openai';

export const QWEN_PROVIDER_TAG = 'qwen-multimodal';

export function getQwenConfig(env = process.env) {
    const apiKey = String(
        env.QWEN_API_KEY || 
        env.DASHSCOPE_API_KEY || 
        env.OPENROUTER_API_KEY || 
        ''
    ).trim();

    if (!apiKey) return null;

    const baseURL = String(
        env.QWEN_BASE_URL || 
        (env.DASHSCOPE_API_KEY ? 'https://dashscope.aliyuncs.com/compatible-mode/v1' : 'https://openrouter.ai/api/v1')
    ).replace(/\/+$/, '');

    const model = String(env.QWEN_MODEL || 'qwen3.8-max').trim();

    return { apiKey, baseURL, model };
}

export function createQwenClient(env = process.env) {
    const config = getQwenConfig(env);
    if (!config) return null;

    return new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        timeout: Number(env.QWEN_API_TIMEOUT_MS || 90000),
    });
}

/**
 * Call Qwen3.8-Max for multimodal game generation or vision check
 * @param {{ systemPrompt: string, messages: Array<any>, temperature?: number, maxTokens?: number }} args 
 * @param {object} env 
 */
export async function callQwenMultimodal({ systemPrompt, messages = [], temperature = 0.3, maxTokens = 4000 }, env = process.env) {
    const config = getQwenConfig(env);
    if (!config) {
        throw new Error('Qwen3.8-Max API key missing (set QWEN_API_KEY or DASHSCOPE_API_KEY)');
    }

    const client = createQwenClient(env);
    const formattedMessages = systemPrompt 
        ? [{ role: 'system', content: systemPrompt }, ...messages]
        : [...messages];

    const response = await client.chat.completions.create({
        model: config.model,
        messages: formattedMessages,
        temperature,
        max_tokens: maxTokens,
    });

    const content = response.choices?.[0]?.message?.content || '';
    return {
        content,
        model: response.model || config.model,
        usage: response.usage || null,
    };
}

/**
 * Call Qwen (via DashScope or OpenRouter) requesting JSON output
 * @param {{ systemPrompt: string, messages: Array<any>, temperature?: number, maxTokens?: number, model?: string }} args 
 * @param {object} env 
 */
export async function callQwenJson({ systemPrompt, messages = [], temperature = 0.3, maxTokens = 8192, model = null }, env = process.env) {
    const config = getQwenConfig(env);
    if (!config) {
        throw new Error('Qwen API key missing (set QWEN_API_KEY, DASHSCOPE_API_KEY, or OPENROUTER_API_KEY)');
    }

    const client = createQwenClient(env);
    const formattedMessages = systemPrompt 
        ? [{ role: 'system', content: systemPrompt }, ...messages]
        : [...messages];

    const response = await client.chat.completions.create({
        model: model || config.model,
        messages: formattedMessages,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
    });

    const content = response.choices?.[0]?.message?.content || '{}';
    try {
        return JSON.parse(content);
    } catch (e) {
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[1]);
        }
        throw e;
    }
}
