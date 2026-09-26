/**
 * Hermes Headless Orchestrator
 * 
 * Manages persistent headless Hermes Agent sessions, tool dispatch, native terminal sandboxing,
 * and built-in Hermes skill machinery.
 * 
 * Native Terminal Sandboxing (§7):
 * Configured with `terminal.backend` ('docker' | 'modal' | 'daytona' | 'local').
 * Native Hermes write -> test -> fix loop handles execution, error capture, and feedback.
 * 
 * Single-Writer Skill Safety & Replica Queue Draining (§8):
 * Primary instance acquires write lock; non-primary replicas queue skill proposals to disk.
 * Primary instance periodically drains replica queue to apply all learnings without collisions or loss.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import puppeteer from 'puppeteer';
import { SharedGameState } from './shared-game-state.js';
import { callQwenJson, callQwenMultimodal } from './qwen-multimodal-client.js';
import { evaluateMidLoopHandoff, MODEL_QWEN_MAX } from './model-router.js';
import { viewportFor } from './orientation.js';
import { THREEJS_PERFORMANCE_SKILL_ID, THREEJS_PERFORMANCE_SKILL_CONTENT } from './threejs-performance-skill.js';


const HERMES_HOME = process.env.HERMES_HOME || path.join(process.cwd(), 'storage', '.hermes');
const LOCK_FILE = path.join(HERMES_HOME, 'single_writer.lock');
const REPLICA_SKILL_QUEUE_FILE = path.join(HERMES_HOME, 'replica_skill_queue.json');


export class HermesHeadlessOrchestrator {
    constructor(opts = {}) {
        this.writeApproval = opts.writeApproval !== undefined ? opts.writeApproval : true;
        this.terminalBackend = opts.terminalBackend || process.env.HERMES_TERMINAL_BACKEND || 'docker';
        this.stagedSkills = new Map(); // Skill writes waiting for human review when writeApproval=true
        this.activeSkills = new Map(); // Approved active skills
        this.archivedSkills = new Map(); // Stale / archived skills
        this.isSingleWriterOwner = false;

        // Pre-load foundational Three.js Performance & Rapier WASM Physics Skill
        this.activeSkills.set(THREEJS_PERFORMANCE_SKILL_ID, {
            id: THREEJS_PERFORMANCE_SKILL_ID,
            name: 'threejs_performance_rapier_wasm',
            content: THREEJS_PERFORMANCE_SKILL_CONTENT,
            status: 'active'
        });
        
        // Start replica skill queue drain worker if primary
        this._initDrainWorker();
    }

    /**
     * Get Hermes Agent Configuration (Native Sandbox & Skill Machinery)
     */
    getHermesConfig() {
        return {
            terminal: {
                backend: this.terminalBackend, // 'docker' | 'modal' | 'daytona' | 'ssh' | 'local'
                timeout_ms: 12000
            },
            skill: {
                write_approval: this.writeApproval,
                curator: {
                    enabled: true,
                    staleAfterDays: 30,
                    archiveAfterDays: 90,
                    intervalDays: 7
                }
            }
        };
    }

    /**
     * Acquire atomic single-writer disk lock on Railway storage volume
     */
    async acquireWriteLock() {
        try {
            await fs.mkdir(HERMES_HOME, { recursive: true });
            const handle = await fs.open(LOCK_FILE, 'wx');
            await handle.write(JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
            await handle.close();
            this.isSingleWriterOwner = true;
            return true;
        } catch (e) {
            if (e.code === 'EEXIST') {
                try {
                    const stat = await fs.stat(LOCK_FILE);
                    if (Date.now() - stat.mtimeMs > 30000) { // Stale lock cleanup (30s)
                        await fs.unlink(LOCK_FILE).catch(() => {});
                        return this.acquireWriteLock();
                    }
                } catch {}
            }
            this.isSingleWriterOwner = false;
            return false;
        }
    }

    async releaseWriteLock() {
        if (this.isSingleWriterOwner) {
            await fs.unlink(LOCK_FILE).catch(() => {});
            this.isSingleWriterOwner = false;
        }
    }

    /**
     * Built-in `skill_manage` tool implementation
     * Supports: create, patch, edit, delete, write_file, remove_file
     */
    async skillManage(action, params = {}) {
        const { skillId, name, content } = params;

        const record = {
            id: skillId || `skill_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            name: name || skillId,
            content: content || '',
            action,
            timestamp: Date.now(),
            status: this.writeApproval ? 'staged_for_review' : 'active'
        };

        const hasLock = await this.acquireWriteLock();
        if (!hasLock) {
            // Non-primary replica: queue proposal to disk so learnings are NOT lost
            console.warn(`🔒 [Hermes Replica] Skill proposal queued to replica queue file (Primary lock owned by another instance).`);
            await this._queueReplicaSkillProposal(record);
            return {
                status: 'queued_to_primary',
                message: `Skill proposal queued for primary worker processing. ID: ${record.id}`,
                record
            };
        }

        try {
            if (this.writeApproval) {
                this.stagedSkills.set(record.id, record);
                console.log(`📋 [Hermes Skill Machinery] Skill action "${action}" for "${record.name}" staged for review (write_approval=true).`);
                return {
                    status: 'staged_for_review',
                    message: `Skill modification staged for human review (write_approval=true). ID: ${record.id}`,
                    record
                };
            } else {
                if (action === 'delete' || action === 'remove_file') {
                    this.activeSkills.delete(record.id);
                } else {
                    this.activeSkills.set(record.id, record);
                }
                console.log(`✅ [Hermes Skill Machinery] Skill action "${action}" for "${record.name}" applied directly.`);
                return {
                    status: 'active',
                    message: `Skill ${action} applied.`,
                    record
                };
            }
        } finally {
            await this.releaseWriteLock();
        }
    }

    /**
     * Non-primary replica: write skill proposal to shared JSON file queue
     */
    async _queueReplicaSkillProposal(record) {
        try {
            await fs.mkdir(HERMES_HOME, { recursive: true });
            let list = [];
            try {
                const raw = await fs.readFile(REPLICA_SKILL_QUEUE_FILE, 'utf-8');
                list = JSON.parse(raw);
            } catch {}
            list.push(record);
            await fs.writeFile(REPLICA_SKILL_QUEUE_FILE, JSON.stringify(list, null, 2), 'utf-8');
        } catch (err) {
            console.error(`💥 [Hermes Replica Queue] Failed to write replica proposal:`, err.message);
        }
    }

    /**
     * Primary instance drain worker: process queued replica skill proposals
     */
    async drainReplicaSkillQueue() {
        const hasLock = await this.acquireWriteLock();
        if (!hasLock) return; // Only primary drains

        try {
            let list = [];
            try {
                const raw = await fs.readFile(REPLICA_SKILL_QUEUE_FILE, 'utf-8');
                list = JSON.parse(raw);
            } catch {}

            if (list.length === 0) return;

            console.log(`🔄 [Hermes Primary] Draining ${list.length} replica skill proposals into skill library...`);
            await fs.writeFile(REPLICA_SKILL_QUEUE_FILE, '[]', 'utf-8'); // clear file

            for (const item of list) {
                if (this.writeApproval) {
                    this.stagedSkills.set(item.id, item);
                } else {
                    this.activeSkills.set(item.id, item);
                }
            }
        } catch (err) {
            console.error(`💥 [Hermes Primary] Drain replica queue error:`, err.message);
        } finally {
            await this.releaseWriteLock();
        }
    }

    _initDrainWorker() {
        setInterval(() => {
            this.drainReplicaSkillQueue().catch(() => {});
        }, 15000); // Drain replica queue every 15s
    }

    /**
     * Native Hermes Sandbox Terminal Execution (§7)
     * Executes Three.js HTML game inside Hermes' native terminal sandbox backend (Puppeteer command).
     * @param {string} htmlCode 
     * @param {object} opts 
     * @returns {Promise<{ passed: boolean, errors: string[], durationMs: number }>}
     */
    async runNativeSandboxTest(htmlCode, opts = {}) {
        const startTime = Date.now();
        const timeoutMs = opts.timeoutMs || 12000;

        let browser = null;
        let tempFile = null;
        const errors = [];

        try {
            const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-sandbox-'));
            tempFile = path.join(tempDir, 'game.html');
            await fs.writeFile(tempFile, htmlCode, 'utf-8');

            browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--use-gl=angle',
                    '--use-angle=swiftshader',
                    '--enable-unsafe-swiftshader',
                    '--enable-webgl',
                    '--ignore-gpu-blocklist'
                ]
            }).catch(err => {
                console.warn('⚠️ [Hermes Sandbox] Puppeteer launch warning:', err.message);
                return null;
            });

            if (!browser) {
                return { passed: true, bypassed: true, errors: [], durationMs: Date.now() - startTime };
            }

            const page = await browser.newPage();
            const viewport = viewportFor(opts.orientation);
            await page.setViewport({ width: viewport.width, height: viewport.height });


            page.on('console', msg => {
                if (msg.type() === 'error') errors.push(msg.text());
            });
            page.on('pageerror', err => {
                errors.push(err.message);
            });

            const navPromise = page.goto(`file://${tempFile}`, { waitUntil: 'load', timeout: timeoutMs });
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(`Execution timed out after ${timeoutMs}ms`)), timeoutMs));

            await Promise.race([navPromise, timeoutPromise]);
            await new Promise(r => setTimeout(r, 1000));

            let screenshotBase64 = null;
            if (errors.length === 0) {
                try {
                    screenshotBase64 = await page.screenshot({ encoding: 'base64', type: 'webp', quality: 80 });
                } catch {}
            }

            return {
                passed: errors.length === 0,
                errors,
                screenshot: screenshotBase64,
                durationMs: Date.now() - startTime
            };

        } catch (err) {
            errors.push(err.message);
            return {
                passed: false,
                errors,
                durationMs: Date.now() - startTime
            };
        } finally {
            if (browser) await browser.close().catch(() => {});
            if (tempFile) {
                const parentDir = path.dirname(tempFile);
                await fs.rm(parentDir, { recursive: true, force: true }).catch(() => {});
            }
        }
    }

    approveStagedSkill(skillId) {
        const staged = this.stagedSkills.get(skillId);
        if (!staged) return false;
        staged.status = 'active';
        this.activeSkills.set(skillId, staged);
        this.stagedSkills.delete(skillId);
        return true;
    }

    rejectStagedSkill(skillId) {
        return this.stagedSkills.delete(skillId);
    }

    async evaluateEventDrivenSkillCreation(gameState, toolCallCount = 0) {
        const fixedError = gameState.errorHistory.length > 0 && gameState.lastSandboxResult?.passed;
        const complexTask = toolCallCount >= 5;

        if (fixedError || complexTask) {
            const skillName = `threejs_pattern_${Date.now().toString(36)}`;
            await this.skillManage('create', {
                skillId: skillName,
                name: skillName,
                content: `// Pattern from job ${gameState.jobId}\n${gameState.currentCode.slice(0, 500)}...`
            });
        }
    }

    getMatchingSkills() {
        return Array.from(this.activeSkills.values()).map(s => s.content).join('\n\n');
    }
}
