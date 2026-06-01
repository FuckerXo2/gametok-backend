const RATE_LIMIT_HEADER_PREFIXES = [
    'x-ratelimit-',
    'x-rate-limit-',
    'ratelimit-',
    'retry-after',
];

const REQUEST_ID_HEADERS = [
    'x-request-id',
    'nv-request-id',
    'request-id',
    'x-nvcf-reqid',
];

function normalizeHeaderName(name) {
    return String(name || '').toLowerCase();
}

export function pickResponseHeaders(headers) {
    if (!headers || typeof headers.forEach !== 'function') {
        return {};
    }

    const picked = {};
    headers.forEach((value, key) => {
        const lower = normalizeHeaderName(key);
        if (REQUEST_ID_HEADERS.includes(lower)) {
            picked[lower] = value;
        }
        if (RATE_LIMIT_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix) || lower === prefix.replace(/-$/, ''))) {
            picked[lower] = value;
        }
    });
    return picked;
}

export function captureStreamConnectDiagnostics(response, requestStartedAt = Date.now()) {
    const status = Number(response?.status || 0) || null;
    const headers = pickResponseHeaders(response?.headers);
    const connectMs = Math.max(0, Date.now() - requestStartedAt);

    return {
        phase: 'connected',
        status,
        connectMs,
        headers,
        requestId: headers['x-request-id'] || headers['nv-request-id'] || headers['x-nvcf-reqid'] || null,
        retryAfter: headers['retry-after'] || null,
    };
}

export function captureStreamConnectError(error, requestStartedAt = Date.now()) {
    const status = Number(error?.status || error?.response?.status || 0) || null;
    const headers = pickResponseHeaders(error?.response?.headers || error?.headers);
    return {
        phase: 'connect_failed',
        status,
        connectMs: Math.max(0, Date.now() - requestStartedAt),
        headers,
        requestId: headers['x-request-id'] || headers['nv-request-id'] || headers['x-nvcf-reqid'] || null,
        retryAfter: headers['retry-after'] || null,
        errorMessage: String(error?.message || error || '').slice(0, 200),
    };
}

export function buildStreamStallDiagnostics({
    requestStartedAt,
    connectDiagnostics = null,
    firstChunkAt = null,
    gotBytes = false,
    idleMs = 0,
    limitMs = 0,
} = {}) {
    const now = Date.now();
    const connectMs = connectDiagnostics?.connectMs ?? (connectDiagnostics ? null : null);
    const waitFirstChunkMs = connectDiagnostics?.phase === 'connected' && !gotBytes && firstChunkAt == null
        ? Math.max(0, now - requestStartedAt - (connectMs || 0))
        : (firstChunkAt && connectDiagnostics?.connectMs != null
            ? Math.max(0, firstChunkAt - requestStartedAt - connectDiagnostics.connectMs)
            : null);

    const phase = gotBytes
        ? 'stream_idle'
        : (connectDiagnostics?.phase === 'connected' ? 'await_first_chunk' : 'connect');

    const diagnostics = {
        phase,
        idleMs,
        limitMs,
        connectMs,
        waitFirstChunkMs,
        status: connectDiagnostics?.status ?? null,
        headers: connectDiagnostics?.headers ?? {},
        requestId: connectDiagnostics?.requestId ?? null,
        retryAfter: connectDiagnostics?.retryAfter ?? null,
    };

    diagnostics.inferredCause = inferStreamStallCause(diagnostics);
    diagnostics.summary = formatStreamDiagnosticsSummary(diagnostics);
    return diagnostics;
}

export function inferStreamStallCause(diagnostics = {}) {
    const status = Number(diagnostics.status || 0);

    if (status === 401 || status === 403) {
        return 'auth_key';
    }

    if (status === 429 || diagnostics.retryAfter || hasRateLimitHeaders(diagnostics.headers)) {
        return 'rate_limit';
    }

    if (status === 404) {
        return 'model_not_found';
    }

    if (diagnostics.phase === 'connect' || diagnostics.connectMs == null) {
        return 'connect_hang';
    }

    if (diagnostics.phase === 'await_first_chunk') {
        return 'provider_queue';
    }

    if (diagnostics.phase === 'stream_idle') {
        return 'provider_midstream';
    }

    return 'unknown';
}

function hasRateLimitHeaders(headers = {}) {
    return Object.keys(headers).some((key) => (
        key.startsWith('x-ratelimit-')
        || key.startsWith('x-rate-limit-')
        || key === 'retry-after'
    ));
}

export function formatStreamConnectLog(diagnostics = {}) {
    const parts = [
        `phase=${diagnostics.phase || 'unknown'}`,
        diagnostics.status ? `status=${diagnostics.status}` : null,
        diagnostics.connectMs != null ? `connectMs=${diagnostics.connectMs}` : null,
        diagnostics.requestId ? `req=${diagnostics.requestId}` : null,
        diagnostics.retryAfter ? `retryAfter=${diagnostics.retryAfter}` : null,
        formatHeaderHints(diagnostics.headers),
    ].filter(Boolean);
    return parts.join(' ');
}

export function formatStreamDiagnosticsSummary(diagnostics = {}) {
    const parts = [
        `phase=${diagnostics.phase}`,
        diagnostics.status ? `status=${diagnostics.status}` : null,
        diagnostics.connectMs != null ? `connectMs=${diagnostics.connectMs}` : null,
        diagnostics.waitFirstChunkMs != null ? `waitFirstChunkMs=${diagnostics.waitFirstChunkMs}` : null,
        `idleMs=${Math.round(diagnostics.idleMs || 0)}`,
        `cause=${diagnostics.inferredCause || inferStreamStallCause(diagnostics)}`,
        diagnostics.requestId ? `req=${diagnostics.requestId}` : null,
        diagnostics.retryAfter ? `retryAfter=${diagnostics.retryAfter}` : null,
        formatHeaderHints(diagnostics.headers),
    ].filter(Boolean);
    return parts.join(' ');
}

function formatHeaderHints(headers = {}) {
    const entries = Object.entries(headers || {});
    if (entries.length === 0) return null;
    const hints = entries
        .slice(0, 4)
        .map(([key, value]) => `${key}=${value}`)
        .join(',');
    return hints ? `headers={${hints}}` : null;
}

export function mapInferredCauseToFailureKind(inferredCause) {
    switch (inferredCause) {
        case 'auth_key':
            return 'key';
        case 'rate_limit':
            return 'key';
        case 'model_not_found':
            return 'model';
        case 'provider_queue':
        case 'provider_midstream':
        case 'connect_hang':
            return 'stall';
        default:
            return 'stall';
    }
}
