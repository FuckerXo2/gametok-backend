/**
 * Shared Game-State Object Schema & Class
 * 
 * Technical foundation for GameTok AI Game Generation Pipeline.
 * Holds all prompt state, code history, visual references, test logs,
 * model ownership, and transition logs to enable lossless bidirectional handoff
 * between DeepSeek-V4-Flash and Qwen3.8-Max.
 */

export class SharedGameState {
    constructor(opts = {}) {
        this.jobId = opts.jobId || `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        this.prompt = opts.prompt || '';
        this.parsedRequirements = opts.parsedRequirements || {};
        this.currentCode = opts.currentCode || '';
        this.diffHistory = opts.diffHistory || [];
        this.visualReferences = opts.visualReferences || [];
        this.attemptCount = opts.attemptCount || 0;
        this.maxAttempts = opts.maxAttempts || 5;
        this.errorHistory = opts.errorHistory || [];
        this.lastSandboxResult = opts.lastSandboxResult || null;
        this.currentModelOwner = opts.currentModelOwner || 'deepseek-v4-flash';
        this.transitionLog = opts.transitionLog || [];
        this.status = opts.status || 'queued';
        this.metadata = opts.metadata || {};
        this.createdTimestamp = opts.createdTimestamp || Date.now();
        this.updatedTimestamp = opts.updatedTimestamp || Date.now();
    }

    /**
     * Record a model handoff in state and update current model owner
     * @param {'deepseek-v4-flash' | 'qwen3.8-max'} toModel 
     * @param {string} reason Rationale for handoff
     */
    transitionModel(toModel, reason) {
        if (this.currentModelOwner === toModel) return;
        const from = this.currentModelOwner;
        this.currentModelOwner = toModel;
        this.updatedTimestamp = Date.now();
        this.transitionLog.push({
            timestamp: this.updatedTimestamp,
            from,
            to: toModel,
            reason: reason || 'Manual or rule-based handoff'
        });
    }

    /**
     * Record code edit / generation result
     * @param {string} code 
     * @param {string} model 
     * @param {string} description 
     */
    updateCode(code, model, description = 'Code update') {
        const previousCode = this.currentCode;
        this.currentCode = code;
        this.updatedTimestamp = Date.now();
        this.diffHistory.push({
            timestamp: this.updatedTimestamp,
            model: model || this.currentModelOwner,
            description,
            codeLength: code.length,
            hasPrevious: Boolean(previousCode)
        });
    }

    /**
     * Record a sandbox test execution attempt
     * @param {object} sandboxResult 
     */
    recordAttempt(sandboxResult) {
        this.attemptCount += 1;
        this.lastSandboxResult = sandboxResult;
        this.updatedTimestamp = Date.now();

        if (sandboxResult && !sandboxResult.passed) {
            this.errorHistory.push({
                attempt: this.attemptCount,
                timestamp: this.updatedTimestamp,
                errors: sandboxResult.errors || [sandboxResult.error || 'Unknown execution error'],
                logs: sandboxResult.logs || [],
                modelOwner: this.currentModelOwner
            });
        }
    }

    /**
     * Attach a visual reference (image, video frame, diagram) to state
     * @param {{ type: string, url?: string, data?: string, description?: string }} ref 
     */
    addVisualReference(ref) {
        this.visualReferences.push({
            id: `vis_${Date.now()}_${this.visualReferences.length}`,
            timestamp: Date.now(),
            ...ref
        });
        this.updatedTimestamp = Date.now();
    }

    toJSON() {
        return {
            jobId: this.jobId,
            prompt: this.prompt,
            parsedRequirements: this.parsedRequirements,
            currentCode: this.currentCode,
            diffHistory: this.diffHistory,
            visualReferences: this.visualReferences,
            attemptCount: this.attemptCount,
            maxAttempts: this.maxAttempts,
            errorHistory: this.errorHistory,
            lastSandboxResult: this.lastSandboxResult,
            currentModelOwner: this.currentModelOwner,
            transitionLog: this.transitionLog,
            status: this.status,
            metadata: this.metadata,
            createdTimestamp: this.createdTimestamp,
            updatedTimestamp: this.updatedTimestamp
        };
    }

    static fromJSON(json) {
        if (typeof json === 'string') {
            json = JSON.parse(json);
        }
        return new SharedGameState(json);
    }
}
