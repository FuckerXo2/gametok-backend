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

export function getStreamStallConfig() {
    return {
        firstByteMs: Math.max(15000, Number(process.env.GAMETOK_STREAM_FIRST_BYTE_MS || 60000)),
        stallMs: Math.max(15000, Number(process.env.GAMETOK_STREAM_STALL_MS || 45000)),
        pollMs: Math.max(2000, Number(process.env.GAMETOK_STREAM_STALL_POLL_MS || 5000)),
    };
}

export function isStreamStallError(error) {
    return error?.code === 'STREAM_STALL' || /stream stalled/i.test(String(error?.message || ''));
}

function linkAbortSignal(source, targetController) {
    if (!source) return () => {};
    if (source.aborted) {
        targetController.abort();
        return () => {};
    }
    const onAbort = () => targetController.abort();
    source.addEventListener('abort', onAbort, { once: true });
    return () => source.removeEventListener('abort', onAbort);
}

/**
 * Stream an NVIDIA chat completion and assemble the final assistant message.
 * Aborts early when no bytes arrive within firstByteMs, or when idle for stallMs mid-stream.
 */
export async function streamChatCompletionToMessage(client, createOptions, {
    signal,
    logLabel = 'stream',
    onChunk = null,
    progressIntervalMs = 15000,
    progressCharStep = 8192,
    firstByteMs = null,
    stallMs = null,
} = {}) {
    const stallConfig = getStreamStallConfig();
    const firstByteTimeoutMs = firstByteMs ?? stallConfig.firstByteMs;
    const idleStallMs = stallMs ?? stallConfig.stallMs;
    const pollMs = stallConfig.pollMs;

    const state = createStreamAccumulator();
    let lastLogAt = Date.now();
    let lastLoggedChars = 0;
    let lastByteAt = Date.now();
    let gotBytes = false;
    let stallAborted = false;

    const stallController = new AbortController();
    const requestController = new AbortController();
    const unlinkExternal = linkAbortSignal(signal, requestController);
    const unlinkStall = linkAbortSignal(stallController.signal, requestController);

    stallController.signal.addEventListener('abort', () => {
        stallAborted = true;
    }, { once: true });

    const stallTimer = setInterval(() => {
        const idleMs = Date.now() - lastByteAt;
        const limitMs = gotBytes ? idleStallMs : firstByteTimeoutMs;
        if (idleMs >= limitMs) {
            console.warn(
                `📡 [${logLabel}] stream stall: idle ${Math.round(idleMs / 1000)}s (limit ${Math.round(limitMs / 1000)}s, firstByte=${gotBytes ? 'yes' : 'no'})`,
            );
            stallController.abort();
        }
    }, pollMs);
    stallTimer.unref?.();

    try {
        const stream = await client.chat.completions.create({
            ...createOptions,
            stream: true,
        }, { signal: requestController.signal });

        for await (const chunk of stream) {
            lastByteAt = Date.now();
            gotBytes = true;
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

        if (stallAborted && !signal?.aborted) {
            const limitSec = Math.round((gotBytes ? idleStallMs : firstByteTimeoutMs) / 1000);
            const stallError = new Error(`Stream stalled: no tokens for ${limitSec}s`);
            stallError.code = 'STREAM_STALL';
            stallError.partialMessage = error.partialMessage;
            stallError.partialStreamStats = error.partialStreamStats;
            throw stallError;
        }

        throw error;
    } finally {
        clearInterval(stallTimer);
        unlinkExternal();
        unlinkStall();
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
