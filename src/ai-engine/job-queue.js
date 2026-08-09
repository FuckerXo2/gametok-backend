/**
 * GameTok Job Queue Infrastructure
 * 
 * Asynchronous job queue manager (§10) ensuring concurrent generation requests
 * are safely queued, processed, and tracked without resource contention.
 */

import { runGameTokGenerationLoop } from './gametok-generation-loop.js';
import { HermesHeadlessOrchestrator } from './hermes-headless-orchestrator.js';

export class GameTokJobQueue {
    constructor(opts = {}) {
        this.concurrency = opts.concurrency || Number(process.env.GAMETOK_MAX_CONCURRENCY || 4);
        this.jobs = new Map();
        this.queue = [];
        this.activeCount = 0;
        this.hermes = new HermesHeadlessOrchestrator({ writeApproval: true });
    }


    /**
     * Enqueue a new game generation job
     * @param {{ prompt: string, attachments?: Array<any>, userId?: string }} jobData 
     * @returns {string} jobId
     */
    enqueueJob(jobData = {}) {
        const jobId = `gt_job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const record = {
            jobId,
            jobData,
            status: 'queued',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            result: null,
            error: null
        };

        this.jobs.set(jobId, record);
        this.queue.push(jobId);

        console.log(`📥 [Job Queue] Enqueued job ${jobId}. Queue length: ${this.queue.length}`);
        this._processNext();

        return jobId;
    }

    /**
     * Get job status / state
     * @param {string} jobId 
     */
    getJob(jobId) {
        return this.jobs.get(jobId) || null;
    }

    /**
     * Process next queued job if concurrency slot available
     */
    async _processNext() {
        if (this.activeCount >= this.concurrency || this.queue.length === 0) {
            return;
        }

        const jobId = this.queue.shift();
        const record = this.jobs.get(jobId);
        if (!record) return;

        this.activeCount += 1;
        record.status = 'processing';
        record.updatedAt = Date.now();

        console.log(`⚙️ [Job Queue] Processing job ${jobId} (Active: ${this.activeCount}/${this.concurrency})`);

        try {
            const finalGameState = await runGameTokGenerationLoop(record.jobData, this.hermes);
            record.status = finalGameState.status;
            record.result = finalGameState.toJSON();
            record.updatedAt = Date.now();
        } catch (err) {
            console.error(`💥 [Job Queue] Job ${jobId} processing error:`, err.message);
            record.status = 'failed';
            record.error = err.message;
            record.updatedAt = Date.now();
        } finally {
            this.activeCount -= 1;
            this._processNext();
        }
    }
}

// Global instance
export const defaultJobQueue = new GameTokJobQueue();
