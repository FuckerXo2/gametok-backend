import {
    buildStreamStallDiagnostics,
    captureStreamConnectDiagnostics,
    captureStreamConnectError,
    formatStreamConnectLog,
    formatStreamDiagnosticsSummary,
} from './stream-diagnostics.js';

export function createStreamAccumulator() {
    return {
        content: '',
        toolCallsByIndex: new Map(),
        finishReason: null,
        streamErrors: [],
    };
}

function chunkHasPayload(chunk) {
    const choice = chunk?.choices?.[0];
    if (!choice) return false;
    if (choice.finish_reason) return true;
    const delta = choice.delta || {};
    if (delta.content) return true;
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) return true;
    return false;
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

    if (chunk?.error) {
        state.streamErrors.push(chunk.error);
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
        firstByteMs: Math.max(15000, Number(process.env.GAMETOK_STREAM_FIRST_BYTE_MS || 180000)),
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

function buildStallError({
    gotBytes,
    idleStallMs,
    firstByteTimeoutMs,
    requestStartedAt,
    connectDiagnostics,
    firstChunkAt,
    idleMs,
    limitMs,
    partialMessage,
    partialStreamStats,
}) {
    const streamDiagnostics = buildStreamStallDiagnostics({
        requestStartedAt,
        connectDiagnostics,
        firstChunkAt,
        gotBytes,
        idleMs,
        limitMs,
    });
    const limitSec = Math.round(limitMs / 1000);
    const stallError = new Error(`Stream stalled: no tokens for ${limitSec}s (${streamDiagnostics.inferredCause})`);
    stallError.code = 'STREAM_STALL';
    stallError.streamDiagnostics = streamDiagnostics;
    stallError.partialMessage = partialMessage;
    stallError.partialStreamStats = partialStreamStats;
    if (streamDiagnostics.status) {
        stallError.status = streamDiagnostics.status;
    }
    return stallError;
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
    const requestStartedAt = Date.now();
    let lastLogAt = Date.now();
    let lastLoggedChars = 0;
    let lastByteAt = requestStartedAt;
    let gotBytes = false;
    let stallAborted = false;
    let connectDiagnostics = null;
    let firstChunkAt = null;
    let stallIdleMs = 0;
    let stallLimitMs = firstByteTimeoutMs;

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
            stallIdleMs = idleMs;
            stallLimitMs = limitMs;
            const preview = buildStreamStallDiagnostics({
                requestStartedAt,
                connectDiagnostics,
                firstChunkAt,
                gotBytes,
                idleMs,
                limitMs,
            });
            console.warn(
                `📡 [${logLabel}] stream stall: ${formatStreamDiagnosticsSummary(preview)} firstByte=${gotBytes ? 'yes' : 'no'}`,
            );
            stallController.abort();
        }
    }, pollMs);
    stallTimer.unref?.();

    try {
        const createPromise = client.chat.completions.create({
            ...createOptions,
            stream: true,
        }, { signal: requestController.signal });

        createPromise.asResponse()
            .then((response) => {
                connectDiagnostics = captureStreamConnectDiagnostics(response, requestStartedAt);
                console.log(`📡 [${logLabel}] stream connected ${formatStreamConnectLog(connectDiagnostics)}`);
            })
            .catch((connectError) => {
                if (!connectDiagnostics) {
                    connectDiagnostics = captureStreamConnectError(connectError, requestStartedAt);
                    console.warn(`📡 [${logLabel}] stream connect failed ${formatStreamConnectLog(connectDiagnostics)} msg=${connectDiagnostics.errorMessage || 'unknown'}`);
                }
            });

        const stream = await createPromise;

        for await (const chunk of stream) {
            if (chunkHasPayload(chunk)) {
                if (!firstChunkAt) {
                    firstChunkAt = Date.now();
                    const ttfbMs = firstChunkAt - requestStartedAt;
                    const afterConnectMs = connectDiagnostics?.connectMs != null
                        ? Math.max(0, firstChunkAt - requestStartedAt - connectDiagnostics.connectMs)
                        : null;
                    console.log(
                        `📡 [${logLabel}] first chunk ttfbMs=${ttfbMs}${afterConnectMs != null ? ` afterConnectMs=${afterConnectMs}` : ''}`,
                    );
                }
                lastByteAt = Date.now();
                gotBytes = true;
            }

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

        if (Array.isArray(state.streamErrors) && state.streamErrors.length > 0) {
            console.warn(`📡 [${logLabel}] stream error events=${JSON.stringify(state.streamErrors).slice(0, 400)}`);
        }

        if (stallAborted && !signal?.aborted) {
            throw buildStallError({
                gotBytes,
                idleStallMs,
                firstByteTimeoutMs,
                requestStartedAt,
                connectDiagnostics,
                firstChunkAt,
                idleMs: stallIdleMs || (Date.now() - lastByteAt),
                limitMs: stallLimitMs,
                partialMessage: error.partialMessage,
                partialStreamStats: error.partialStreamStats,
            });
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

    if (stats.totalChars === 0 && stats.toolCallCount === 0) {
        const emptyError = new Error(`Stream completed with no content and no tool_calls (finish=${state.finishReason || 'unknown'})`);
        emptyError.code = 'STREAM_EMPTY';
        emptyError.status = connectDiagnostics?.status ?? 502;
        emptyError.streamDiagnostics = buildStreamStallDiagnostics({
            requestStartedAt,
            connectDiagnostics,
            firstChunkAt,
            gotBytes,
            idleMs: Date.now() - lastByteAt,
            limitMs: 0,
        });
        throw emptyError;
    }

    return message;
}

export function useMakerAgentStreaming() {
    return String(process.env.GAMETOK_MAKER_AGENT_STREAMING || 'true').toLowerCase() !== 'false';
}
