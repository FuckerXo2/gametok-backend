export function createStreamAccumulator() {
    return {
        content: '',
        toolCallsByIndex: new Map(),
        finishReason: null,
    };
}

export function applyStreamChunk(state, chunk) {
    const choice = chunk?.choices?.[0];
    if (!choice) return state;

    if (choice.finish_reason) {
        state.finishReason = choice.finish_reason;
    }

    const delta = choice.delta || {};
    if (delta.content) {
        state.content += delta.content;
    }

    if (Array.isArray(delta.tool_calls)) {
        for (const toolDelta of delta.tool_calls) {
            const index = toolDelta.index ?? 0;
            let existing = state.toolCallsByIndex.get(index);
            if (!existing) {
                existing = {
                    id: '',
                    type: 'function',
                    function: { name: '', arguments: '' },
                };
                state.toolCallsByIndex.set(index, existing);
            }
            if (toolDelta.id) existing.id = toolDelta.id;
            if (toolDelta.type) existing.type = toolDelta.type;
            if (toolDelta.function?.name) {
                existing.function.name += toolDelta.function.name;
            }
            if (toolDelta.function?.arguments) {
                existing.function.arguments += toolDelta.function.arguments;
            }
        }
    }

    return state;
}

export function getStreamProgressStats(state) {
    const toolCalls = Array.from(state.toolCallsByIndex.values());
    const argumentChars = toolCalls.reduce(
        (sum, call) => sum + String(call.function?.arguments || '').length,
        0,
    );
    return {
        contentChars: state.content.length,
        toolCallCount: toolCalls.length,
        toolNames: toolCalls.map((call) => call.function?.name).filter(Boolean),
        argumentChars,
        totalChars: state.content.length + argumentChars,
    };
}

export function finalizeStreamedMessage(state) {
    const tool_calls = Array.from(state.toolCallsByIndex.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([, call]) => call)
        .filter((call) => call.id || call.function?.name);

    return {
        role: 'assistant',
        content: state.content || null,
        ...(tool_calls.length > 0 ? { tool_calls } : {}),
    };
}

/**
 * Stream an NVIDIA chat completion and assemble the final assistant message.
 */
export async function streamChatCompletionToMessage(client, createOptions, {
    signal,
    logLabel = 'stream',
    onChunk = null,
    progressIntervalMs = 15000,
    progressCharStep = 8192,
} = {}) {
    const state = createStreamAccumulator();
    let lastLogAt = Date.now();
    let lastLoggedChars = 0;

    const stream = await client.chat.completions.create({
        ...createOptions,
        stream: true,
    }, { signal });

    try {
        for await (const chunk of stream) {
            applyStreamChunk(state, chunk);
            if (typeof onChunk === 'function') {
                onChunk(chunk, state, getStreamProgressStats(state));
            }

            const stats = getStreamProgressStats(state);
            const now = Date.now();
            if (
                stats.totalChars > 0
                && (now - lastLogAt >= progressIntervalMs || stats.totalChars - lastLoggedChars >= progressCharStep)
            ) {
                console.log(
                    `📡 [${logLabel}] streaming content=${stats.contentChars} tool_args=${stats.argumentChars} tools=[${stats.toolNames.join(',') || 'pending'}] total=${stats.totalChars}`,
                );
                lastLogAt = now;
                lastLoggedChars = stats.totalChars;
            }
        }
    } catch (error) {
        const stats = getStreamProgressStats(state);
        if (stats.totalChars > 0) {
            console.warn(
                `📡 [${logLabel}] stream interrupted after ${stats.totalChars} chars (content=${stats.contentChars}, tool_args=${stats.argumentChars}, tools=[${stats.toolNames.join(',')}])`,
            );
            error.partialMessage = finalizeStreamedMessage(state);
            error.partialStreamStats = stats;
        }
        throw error;
    }

    const message = finalizeStreamedMessage(state);
    const stats = getStreamProgressStats(state);
    console.log(
        `📡 [${logLabel}] stream complete finish=${state.finishReason || 'unknown'} content=${stats.contentChars} tool_calls=${stats.toolCallCount} tool_args=${stats.argumentChars}`,
    );
    return message;
}

export function useMakerAgentStreaming() {
    return String(process.env.GAMETOK_MAKER_AGENT_STREAMING || 'true').toLowerCase() !== 'false';
}
