import { isStreamStallError } from './maker-agent-stream.js';
import { mapInferredCauseToFailureKind } from './stream-diagnostics.js';

export const ProviderFailureKind = {
    KEY: 'key',
    MODEL: 'model',
    STALL: 'stall',
    TIMEOUT: 'timeout',
    UNKNOWN: 'unknown',
};

export function extractProviderErrorStatus(error) {
    const status = Number(
        error?.status
        ?? error?.response?.status
        ?? error?.response?.statusCode
        ?? 0,
    );
    return Number.isFinite(status) && status > 0 ? status : null;
}

export function classifyProviderError(error) {
    const status = extractProviderErrorStatus(error);
    const code = String(error?.code || error?.error?.code || '').toLowerCase();
    const message = String(error?.message || error || '').toLowerCase();

    if (isStreamStallError(error)) {
        const inferredCause = error?.streamDiagnostics?.inferredCause || 'stream_stall';
        const mappedKind = mapInferredCauseToFailureKind(inferredCause);
        const kind = mappedKind === 'key'
            ? ProviderFailureKind.KEY
            : mappedKind === 'model'
                ? ProviderFailureKind.MODEL
                : ProviderFailureKind.STALL;
        return {
            kind,
            reason: inferredCause,
            status: error?.streamDiagnostics?.status ?? status,
            summary: error?.streamDiagnostics?.summary ?? null,
        };
    }

    if (status === 401 || status === 403 || code === 'invalid_api_key' || /invalid.*api.*key|unauthorized|authentication|permission denied/.test(message)) {
        return { kind: ProviderFailureKind.KEY, reason: 'auth', status };
    }

    if (status === 429 || code === 'rate_limit_exceeded' || /rate limit|too many requests|quota|capacity|throttl/.test(message)) {
        return { kind: ProviderFailureKind.KEY, reason: 'rate_limit', status };
    }

    if (status === 404 || /model.*not found|unknown model|does not exist|not available/.test(message)) {
        return { kind: ProviderFailureKind.MODEL, reason: 'model_not_found', status };
    }

    if (status >= 500 && status < 600) {
        return { kind: ProviderFailureKind.STALL, reason: 'provider_server_error', status };
    }

    if (/timed out after \d+s/.test(message) || code === 'etimedout' || code === 'econnaborted') {
        return { kind: ProviderFailureKind.TIMEOUT, reason: 'hard_timeout', status };
    }

    return {
        kind: ProviderFailureKind.UNKNOWN,
        reason: message.slice(0, 160) || 'unknown_error',
        status,
    };
}

/**
 * Decide whether to rotate keys, switch models, or abort.
 */
export function decideProviderRetryAction(classification, {
    attempt = 1,
    maxAttempts = 2,
    stallsOnCurrentModel = 0,
} = {}) {
    if (classification.kind === ProviderFailureKind.MODEL) {
        return 'switch_model';
    }

    if (classification.kind === ProviderFailureKind.STALL) {
        if (classification.reason === 'provider_server_error' || classification.reason === 'provider_queue' || classification.reason === 'connect_hang') {
            return 'switch_model';
        }
        if (classification.reason === 'provider_midstream') {
            return attempt < maxAttempts ? 'rotate_key' : 'switch_model';
        }
        if (stallsOnCurrentModel >= 2) {
            return 'switch_model';
        }
        return attempt < maxAttempts ? 'rotate_key' : 'switch_model';
    }

    if (classification.kind === ProviderFailureKind.KEY) {
        return attempt < maxAttempts ? 'rotate_key' : 'switch_model';
    }

    if (classification.kind === ProviderFailureKind.TIMEOUT) {
        return attempt < maxAttempts ? 'rotate_key' : 'switch_model';
    }

    return attempt < maxAttempts ? 'rotate_key' : 'switch_model';
}

export function formatProviderRetryDecision(classification, action) {
    const actionText = {
        rotate_key: 'rotate API key',
        switch_model: 'switch model',
        throw: 'abort',
    }[action] || action;

    const statusSuffix = classification.status ? ` status=${classification.status}` : '';
    const causeSuffix = classification.reason && classification.reason !== 'stream_stall'
        ? ` cause=${classification.reason}`
        : '';
    return `${classification.kind}/${classification.reason}${statusSuffix}${causeSuffix} → ${actionText}`;
}

export function shouldMoonshotFailover(modelFailures = [], lastError = null) {
    if (!Array.isArray(modelFailures) || modelFailures.length === 0) {
        return false;
    }

    const providerKinds = new Set([
        ProviderFailureKind.STALL,
        ProviderFailureKind.TIMEOUT,
    ]);

    const allModelsProviderBlocked = modelFailures.every((entry) => (
        entry.stalls > 0
        || (Array.isArray(entry.kinds) && entry.kinds.length > 0 && entry.kinds.every((kind) => providerKinds.has(kind)))
    ));

    if (allModelsProviderBlocked) {
        return true;
    }

    const lastClassification = classifyProviderError(lastError);
    return providerKinds.has(lastClassification.kind);
}
