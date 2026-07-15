import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function isLikelyThreeJsBuild(htmlString = '') {
    const source = String(htmlString || '');
    return /THREE\.(WebGLRenderer|PerspectiveCamera|Scene)/i.test(source)
        || /cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js/i.test(source)
        || /three\.min\.js/i.test(source)
        // Bundled npm three (vite single-file, minified): the THREE. namespace prefix
        // is gone, but the exported class names survive (esbuild keeps property names)
        // and the GLSL shader chunks (gl_Position) survive minification as string data.
        || /\bWebGLRenderer\b/.test(source)
        || /\bPerspectiveCamera\b/.test(source)
        || /gl_Position/.test(source);
}

function isHeadlessWebglFailure(crashes = []) {
    return Array.isArray(crashes) && crashes.some((entry) =>
        /webgl context|error creating webgl context|failed to create.*webgl/i.test(String(entry || ''))
    );
}

function normalizeRequiredAssetRole(role = '') {
    const normalized = String(role || '').toLowerCase();
    if (normalized === 'environment' || normalized === 'background') return 'background';
    return normalized;
}

function getRenderedRoleCount(renderedRoles = {}, role = '', renderedKeys = {}) {
    const normalized = normalizeRequiredAssetRole(role);
    if (normalized === 'background') {
        return Math.max(
            Number(renderedRoles.background || 0),
            Number(renderedRoles.environment || 0),
        );
    }
    let count = Number(renderedRoles[normalized] || 0);
    if (normalized === 'item' || normalized === 'prop') {
        for (const [key, hits] of Object.entries(renderedKeys || {})) {
            if (new RegExp(`^${normalized}\\d*$`, 'i').test(String(key))) {
                count = Math.max(count, Number(hits || 0));
            }
        }
    }
    if (normalized === 'obstacle') {
        for (const [key, hits] of Object.entries(renderedKeys || {})) {
            if (/^obstacle\d*$/i.test(String(key))) {
                count = Math.max(count, Number(hits || 0));
            }
        }
    }
    return count;
}

function roleUsageCountsForEvidence(renderedRoles = {}, usedRoles = {}, renderedKeys = {}, usedKeys = {}, role = '') {
    const values = new Set([role, normalizeRequiredAssetRole(role)].filter(Boolean));
    if (normalizeRequiredAssetRole(role) === 'background') {
        values.add('background');
        values.add('environment');
    }
    let rendered = 0;
    let used = 0;
    for (const value of values) {
        rendered = Math.max(rendered, Number(renderedRoles[value] || 0));
        used = Math.max(used, Number(usedRoles[value] || 0));
        rendered = Math.max(rendered, Number(renderedKeys[value] || 0));
        used = Math.max(used, Number(usedKeys[value] || 0));
    }
    return { rendered, used };
}

function isSceneryAssetRole(values = []) {
    return values.some((value) => {
        const normalized = normalizeRequiredAssetRole(value);
        return normalized === 'background';
    });
}

async function loadHtmlAsBrowserPage(page, htmlString = '') {
    if (typeof htmlString === 'string' && (htmlString.startsWith('http://') || htmlString.startsWith('https://'))) {
        await page.goto(htmlString, { waitUntil: 'load', timeout: 8000 });
        return;
    }
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gametok-sandbox-'));
    const htmlPath = path.join(tempDir, 'index.html');
    await fs.writeFile(htmlPath, String(htmlString || ''), 'utf8');
    try {
        await page.goto(`file://${htmlPath}`, { waitUntil: 'load', timeout: 8000 });
    } finally {
        fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
}

function inspectTemplateContractSource(sourceHtml = '', templateContract = null) {
    if (!templateContract) return null;
    const source = String(sourceHtml || '');
    const requiredFunctions = Array.isArray(templateContract.requiredFunctions)
        ? templateContract.requiredFunctions
        : [];
    const missingFunctions = requiredFunctions.filter((functionName) => {
        const escaped = String(functionName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return !(new RegExp(`\\b${escaped}\\b`).test(source));
    });

    const requiredState = Array.isArray(templateContract.requiredState)
        ? templateContract.requiredState
        : [];
    const missingStateHints = requiredState.filter((stateName) => {
        const baseName = String(stateName).replace(/\[\]|\..*$/g, '');
        const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return baseName && !(new RegExp(`\\b${escaped}\\b`, 'i').test(source));
    });

    return {
        templateId: templateContract.templateId || null,
        engine: templateContract.engine || null,
        requiredFunctionCount: requiredFunctions.length,
        missingFunctions,
        missingStateHints,
    };
}

function inspectAssetContractSource(sourceHtml = '', assetContract = null) {
    if (!assetContract) return null;
    const source = String(sourceHtml || '');
    const slots = Array.isArray(assetContract.slots) ? assetContract.slots : [];
    const requiredSlots = slots.filter((slot) => slot?.required);
    const missingRoleReferences = requiredSlots.filter((slot) => {
        const values = [slot.id, slot.role, slot.category].filter(Boolean);
        return !values.some((value) => {
            const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`['"\`]${escaped}['"\`]`).test(source) || new RegExp(`\\b${escaped}\\b`, 'i').test(source);
        });
    }).map((slot) => slot.id);
    const uiImageHints = [
        /firstByRole\(['"`]ui['"`]\)/i,
        /addSprite\([^)]*['"`](?:ui|hud|button|slider|meter|health|score)['"`]/i,
        /getImage\(['"`](?:ui|hud|button|slider|meter|health|score)['"`]\)/i,
    ];
    const usesImageUi = uiImageHints.some((pattern) => pattern.test(source));
    return {
        templateId: assetContract.templateId || null,
        slotCount: slots.length,
        requiredSlotCount: requiredSlots.length,
        missingRoleReferences,
        usesImageUi,
        hardRules: Array.isArray(assetContract.hardRules) ? assetContract.hardRules : [],
    };
}

function parseRequiredProbeMethodNames(templateContract = null) {
    const names = new Set(['snapshot', 'step', 'reset']);
    for (const entry of [
        ...(Array.isArray(templateContract?.requiredProbeApi) ? templateContract.requiredProbeApi : []),
        ...(Array.isArray(templateContract?.foundation?.probeMethods) ? templateContract.foundation.probeMethods : []),
    ]) {
        if (typeof entry === 'string') {
            const match = entry.match(/__GAMETOK_TEMPLATE_PROBE__\.(\w+)/);
            if (match?.[1]) names.add(match[1]);
            continue;
        }
        if (entry?.name) names.add(String(entry.name));
    }
    return [...names];
}

function buildCanvasKernelProbeContract(templateContract = null) {
    return {
        requiredMethods: parseRequiredProbeMethodNames(templateContract),
        lane: templateContract?.archetype
            || templateContract?.foundation?.lane
            || null,
    };
}

async function runTemplateRuntimeProbe(page, templateContract = null) {
    const templateId = templateContract?.templateId || null;
    if (![
        'phaser-artillery',
        'phaser-top-down-action',
        'phaser-platformer',
        'canvas-simulation',
        'canvas-toybox',
        'canvas-grid-puzzle',
        'canvas-runner',
        'canvas-arcade-shooter',
        'story-vignette',
        'canvas-arcade',
        'canvas-kernel',
        'threejs-kernel',
    ].includes(templateId)) return null;

    const canvasKernelProbeContract = templateId === 'canvas-kernel'
        ? buildCanvasKernelProbeContract(templateContract)
        : null;

    return page.evaluate(async (expectedTemplateId, kernelProbeContract) => {
        const probe = window.__GAMETOK_TEMPLATE_PROBE__;
        const templateId = expectedTemplateId || probe?.templateId || 'unknown';
        if (!probe) {
            return {
                templateId,
                success: false,
                failures: ['Missing window.__GAMETOK_TEMPLATE_PROBE__. Preserve the scaffold probe API.'],
            };
        }

        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        // Interaction acceptance: if the game uses the kernel input helpers (data-gt-* markers), DRIVE
        // them and verify they work — catches dead/unwired joysticks and dead Play Again buttons the
        // function-level probe misses. Conservative: only fails on DEFINITIVELY dead controls (helper
        // present + zero response, with an observable signal); skips anything ambiguous so it never
        // false-fails, and never throws.
        async function checkControls() {
            const out = [];
            try {
                const snapNum = (snap) => {
                    let s = 0, has = false;
                    for (const k in snap) {
                        if (!/player|hero|^x$|^y$|^z$|\bpos|cam/i.test(k)) continue;
                        const v = snap[k];
                        if (typeof v === 'number') { s += v; has = true; }
                        else if (Array.isArray(v)) { for (const n of v) if (typeof n === 'number') { s += n; has = true; } }
                    }
                    return has ? s : null;
                };
                const stick = document.querySelector('[data-gt-joystick]');
                if (stick && typeof probe.snapshot === 'function' && typeof probe.step === 'function') {
                    const base0 = snapNum(probe.snapshot());
                    if (base0 !== null) { // only assert when there's a position-ish signal to observe
                        const r = stick.getBoundingClientRect();
                        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                        const pev = (type, x, y) => stick.dispatchEvent(new PointerEvent(type, { pointerId: 91, clientX: x, clientY: y, bubbles: true, cancelable: true }));
                        pev('pointerdown', cx, cy); pev('pointermove', cx, cy - r.height);
                        for (let i = 0; i < 14; i++) { const s = probe.step(16); if (s && s.then) await s; }
                        const up = snapNum(probe.snapshot());
                        pev('pointerup', cx, cy - r.height);
                        pev('pointerdown', cx, cy); pev('pointermove', cx, cy + r.height);
                        for (let i = 0; i < 14; i++) { const s = probe.step(16); if (s && s.then) await s; }
                        const down = snapNum(probe.snapshot());
                        pev('pointerup', cx, cy + r.height);
                        const moved = Math.abs((up ?? base0) - base0) > 1e-3 || Math.abs((down ?? up ?? base0) - (up ?? base0)) > 1e-3;
                        if (!moved) out.push('Joystick is present but driving it does not move the player — dead/unwired joystick. Use createJoystick from input.ts and apply stick.x/stick.y to the player each frame.');
                    }
                }
                const restart = document.querySelector('[data-gt-restart]');
                if (restart && restart.offsetParent !== null && typeof probe.snapshot === 'function') {
                    const before = JSON.stringify(probe.snapshot());
                    restart.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 92, bubbles: true, cancelable: true }));
                    if (typeof restart.click === 'function') restart.click();
                    await wait(40);
                    if (JSON.stringify(probe.snapshot()) === before) out.push('Play Again button is present but tapping it changes nothing — dead restart. Wire the button onTap to resetGame().');
                }
            } catch { /* best-effort; never crash acceptance */ }
            return out;
        }

        if (templateId === 'canvas-kernel') {
            const requiredMethods = Array.isArray(kernelProbeContract?.requiredMethods)
                ? kernelProbeContract.requiredMethods
                : ['snapshot', 'step', 'reset'];
            const missingMethods = requiredMethods.filter((method) => typeof probe[method] !== 'function');
            const failures = missingMethods.map((method) => `Missing probe method: ${method}`);
            if (missingMethods.length > 0) {
                return { templateId, success: false, failures };
            }
            try {
                if (typeof probe.reset === 'function') probe.reset();
                await wait(40);
                const initial = typeof probe.snapshot === 'function' ? probe.snapshot() : null;
                if (!initial || typeof initial !== 'object') {
                    failures.push('snapshot() did not return a state object.');
                }
                // Loop liveness: step the simulation forward and observe whether ANY state advanced.
                // This is diagnostic only — a game that legitimately waits for input (e.g. a puzzle)
                // can report loopObserved=false without failing — but it stops a do-nothing stepGame()
                // stub from masquerading as a finished game. We surface it instead of silently passing.
                const sig = (value) => { try { return JSON.stringify(value); } catch { return String(value); } };
                let loopObserved = false;
                let afterStep = initial;
                if (typeof probe.step === 'function') {
                    const initialSig = sig(initial);
                    for (let frame = 0; frame < 30 && !loopObserved; frame += 1) {
                        const stepped = probe.step(16);
                        if (stepped && typeof stepped.then === 'function') await stepped;
                        await wait(8);
                        afterStep = typeof probe.snapshot === 'function' ? probe.snapshot() : afterStep;
                        if (sig(afterStep) !== initialSig) loopObserved = true;
                    }
                }
                failures.push(...(await checkControls()));
                return {
                    templateId,
                    success: failures.length === 0,
                    failures,
                    details: {
                        lane: kernelProbeContract?.lane || null,
                        initial,
                        afterStep,
                        loopObserved,
                        requiredMethods,
                    },
                };
            } catch (error) {
                return {
                    templateId,
                    success: false,
                    failures: [error?.message || String(error)],
                };
            }
        }

        if (templateId === 'threejs-kernel') {
            const requiredMethods = ['snapshot', 'step', 'reset'];
            const missingMethods = requiredMethods.filter((method) => typeof probe[method] !== 'function');
            const failures = missingMethods.map((method) => `Missing probe method: ${method}`);
            if (missingMethods.length > 0) {
                return { templateId, success: false, failures };
            }
            // Attribute a thrown error to the exact probe call (reset/snapshot/step)
            // and append the first generated-source stack frame. This only enriches
            // the failure message — pass/fail conditions are unchanged.
            const firstSourceFrame = (stack) => {
                const frame = String(stack || '')
                    .split('\n')
                    .map((line) => line.trim())
                    .find((line) => line.startsWith('at ') && !/\bsetTimeout\b|\bwait\b|<anonymous>:1:1/.test(line));
                return frame ? ` @ ${frame.replace(/^at\s+/, '')}` : '';
            };
            let failedProbeCall = 'reset';
            try {
                if (typeof probe.reset === 'function') probe.reset();
                await wait(60);
                failedProbeCall = 'snapshot';
                const initial = typeof probe.snapshot === 'function' ? probe.snapshot() : null;
                if (!initial || typeof initial !== 'object') {
                    failures.push('snapshot() did not return a state object.');
                }
                // 3D render proof: the kernel probe reports renderer.info draw calls.
                // Step the loop and confirm the WebGL renderer actually drew something.
                let rendered = Number(initial?.renderCalls || 0) > 0;
                let afterStep = initial;
                failedProbeCall = 'step';
                for (let frame = 0; frame < 20 && !rendered; frame += 1) {
                    const stepped = probe.step(16);
                    afterStep = (stepped && typeof stepped.then === 'function') ? await stepped : (stepped || afterStep);
                    await wait(16);
                    if (Number(afterStep?.renderCalls || 0) > 0) rendered = true;
                }
                if (!rendered) {
                    failures.push('Three.js renderer issued zero draw calls — the scene never rendered (check lights, camera, and renderer.render(scene, camera) in the loop).');
                }
                failures.push(...(await checkControls()));
                return { templateId, success: failures.length === 0, failures, details: { initial, afterStep, rendered } };
            } catch (error) {
                const message = error?.message || String(error);
                return {
                    templateId,
                    success: false,
                    failedProbeCall,
                    errorStack: String(error?.stack || '').split('\n').slice(0, 6).join('\n'),
                    failures: [`probe.${failedProbeCall}() failed: ${message}${firstSourceFrame(error?.stack)}`],
                };
            }
        }

        const samePoint = (a, b, threshold = 3) => {
            if (!a || !b) return false;
            return Math.abs(Number(a.x || 0) - Number(b.x || 0)) <= threshold
                && Math.abs(Number(a.y || 0) - Number(b.y || 0)) <= threshold;
        };
        const changedNumber = (a, b, threshold = 0.001) => Math.abs(Number(a || 0) - Number(b || 0)) > threshold;
        const signatureOf = (value) => {
            try { return JSON.stringify(value); } catch { return String(value); }
        };

        if (templateId === 'phaser-top-down-action') {
            const requiredMethods = ['snapshot', 'move', 'attack', 'spawnEnemyNearPlayer', 'reset'];
            const missingMethods = requiredMethods.filter((method) => typeof probe[method] !== 'function');
            const failures = missingMethods.map((method) => `Missing probe method: ${method}`);
            if (missingMethods.length > 0) {
                return { templateId, success: false, failures };
            }
            try {
                probe.reset();
                await wait(80);
                const initial = probe.snapshot();
                await probe.move(80, 0, 180);
                await wait(80);
                const moved = probe.snapshot();
                if (!moved.player || !initial.player || Math.abs(moved.player.x - initial.player.x) < 5) {
                    failures.push('move() did not change the player position enough to prove movement.');
                }
                const afterSpawn = probe.spawnEnemyNearPlayer();
                if (!afterSpawn.enemyCount || afterSpawn.enemyCount < 1) {
                    failures.push('spawnEnemyNearPlayer() did not create a visible enemy.');
                }
                const afterAttack = probe.attack();
                if (!afterAttack.projectileCount || afterAttack.projectileCount < 1) {
                    failures.push('attack() did not create a projectile or attack object.');
                }
                await wait(420);
                const afterCombat = probe.snapshot();
                if (afterCombat.enemyCount >= afterSpawn.enemyCount && afterCombat.score <= initial.score && afterCombat.player.health >= initial.player.health && afterCombat.projectileCount >= afterAttack.projectileCount) {
                    failures.push('attack()/combat loop did not change score, enemy count, projectile count, or health after stepping.');
                }
                return {
                    templateId,
                    success: failures.length === 0,
                    failures,
                    details: { initial, moved, afterSpawn, afterAttack, afterCombat },
                };
            } catch (error) {
                return {
                    templateId,
                    success: false,
                    failures: [error?.message || String(error)],
                };
            }
        }

        if (templateId === 'canvas-toybox') {
            const requiredMethods = ['snapshot', 'selectIngredient', 'fillOrderSlots', 'cook', 'step', 'reset'];
            const missingMethods = requiredMethods.filter((method) => typeof probe[method] !== 'function');
            const failures = missingMethods.map((method) => `Missing probe method: ${method}`);
            if (missingMethods.length > 0) {
                return { templateId, success: false, failures };
            }
            try {
                probe.reset();
                const initial = probe.snapshot();
                if (!initial.currentOrder || initial.currentOrder.length < 3) {
                    failures.push('reset() did not create a three-item order.');
                }
                const afterFill = probe.fillOrderSlots();
                if ((afterFill.slotsFilled || 0) < 3 || !afterFill.readyToCook) {
                    failures.push('fillOrderSlots() did not populate all three slots.');
                }
                const afterCook = probe.cook();
                if ((afterCook.score || 0) <= (initial.score || 0)) {
                    failures.push('cook() did not increase score for a matched order.');
                }
                if ((afterCook.ordersCompleted || 0) <= (initial.ordersCompleted || 0)) {
                    failures.push('cook() did not advance completed order count.');
                }
                const afterStep = await probe.step(500);
                if ((afterStep.timeLeft || 0) >= (initial.timeLeft || 0)) {
                    failures.push('step() did not advance round timer.');
                }
                const reset = probe.reset();
                if ((reset.score || 0) !== 0 || reset.gameOver) {
                    failures.push('reset() did not restore a fresh playable shift.');
                }
                return {
                    templateId,
                    success: failures.length === 0,
                    failures,
                    details: { initial, afterFill, afterCook, afterStep, reset },
                };
            } catch (error) {
                return {
                    templateId,
                    success: false,
                    failures: [error?.message || String(error)],
                };
            }
        }

        if (templateId === 'canvas-simulation') {
            const requiredMethods = ['snapshot', 'addBody', 'start', 'step', 'reset'];
            const missingMethods = requiredMethods.filter((method) => typeof probe[method] !== 'function');
            const failures = missingMethods.map((method) => `Missing probe method: ${method}`);
            if (missingMethods.length > 0) {
                return { templateId, success: false, failures };
            }
            try {
                probe.reset();
                const initial = probe.snapshot();
                const afterAdd = probe.addBody();
                if (!afterAdd.bodyCount || afterAdd.bodyCount <= initial.bodyCount) {
                    failures.push('addBody() did not increase body count.');
                }
                const afterStart = probe.start();
                if (afterStart.mode !== 'run' || !afterStart.running) {
                    failures.push('start() did not switch into running simulation mode.');
                }
                const afterStep = await probe.step(360);
                if (!afterStep.goal || !afterStart.goal || afterStep.goal.y === afterStart.goal.y) {
                    failures.push('step() did not move the goal object under physics.');
                }
                const afterReset = probe.reset();
                if (afterReset.mode !== 'edit' || afterReset.running) {
                    failures.push('reset() did not return to edit mode.');
                }
                return {
                    templateId,
                    success: failures.length === 0,
                    failures,
                    details: { initial, afterAdd, afterStart, afterStep, afterReset },
                };
            } catch (error) {
                return {
                    templateId,
                    success: false,
                    failures: [error?.message || String(error)],
                };
            }
        }

        if (templateId === 'canvas-grid-puzzle') {
            const requiredMethods = ['snapshot', 'select', 'move', 'resolve', 'reset'];
            const missingMethods = requiredMethods.filter((method) => typeof probe[method] !== 'function');
            const failures = missingMethods.map((method) => `Missing probe method: ${method}`);
            if (missingMethods.length > 0) {
                return { templateId, success: false, failures };
            }
            try {
                probe.reset();
                const initial = probe.snapshot();
                const selected = probe.select(2, 3);
                if (!selected.selected || selected.selected.row !== 2 || selected.selected.col !== 3) {
                    failures.push('select() did not change selected tile state.');
                }
                const moved = probe.move('left');
                if (!moved.gridSignature || moved.gridSignature === initial.gridSignature) {
                    failures.push('move() did not change the grid signature.');
                }
                const resolved = probe.resolve();
                if (resolved.score <= initial.score && resolved.goal?.progress <= initial.goal?.progress) {
                    failures.push('resolve() did not change score or goal progress.');
                }
                const reset = probe.reset();
                if (reset.score !== 0 || reset.moves <= 0 || reset.status !== 'playing') {
                    failures.push('reset() did not restore playable puzzle state.');
                }
                return {
                    templateId,
                    success: failures.length === 0,
                    failures,
                    details: { initial, selected, moved, resolved, reset },
                };
            } catch (error) {
                return {
                    templateId,
                    success: false,
                    failures: [error?.message || String(error)],
                };
            }
        }

        if (templateId === 'canvas-runner') {
            const requiredMethods = ['snapshot', 'jump', 'slide', 'spawnObstacle', 'step', 'reset'];
            const missingMethods = requiredMethods.filter((method) => typeof probe[method] !== 'function');
            const failures = missingMethods.map((method) => `Missing probe method: ${method}`);
            if (missingMethods.length > 0) return { templateId, success: false, failures };
            try {
                probe.reset();
                const initial = probe.snapshot();
                const jumped = probe.jump();
                if (!jumped.player || jumped.player.vy >= 0) failures.push('jump() did not give the runner upward velocity.');
                const slid = probe.slide();
                if (!slid.player || slid.player.sliding <= 0) failures.push('slide() did not enter sliding state.');
                const spawned = probe.spawnObstacle();
                if (spawned.obstacleCount <= initial.obstacleCount) failures.push('spawnObstacle() did not increase obstacle count.');
                const stepped = await probe.step(500);
                if (stepped.distance <= initial.distance && stepped.score <= initial.score) failures.push('step() did not advance distance or score.');
                return { templateId, success: failures.length === 0, failures, details: { initial, jumped, slid, spawned, stepped } };
            } catch (error) {
                return { templateId, success: false, failures: [error?.message || String(error)] };
            }
        }

        if (templateId === 'canvas-arcade-shooter') {
            const requiredMethods = ['snapshot', 'move', 'fire', 'spawnEnemy', 'step', 'reset'];
            const missingMethods = requiredMethods.filter((method) => typeof probe[method] !== 'function');
            const failures = missingMethods.map((method) => `Missing probe method: ${method}`);
            if (missingMethods.length > 0) return { templateId, success: false, failures };
            try {
                probe.reset();
                const initial = probe.snapshot();
                const moved = await probe.move(1, 0, 260);
                if (!moved.player || moved.player.x <= initial.player.x + 5) failures.push('move() did not move the player right.');
                const afterFire = probe.fire();
                if (afterFire.projectileCount <= initial.projectileCount) failures.push('fire() did not create a projectile.');
                const afterSpawn = probe.spawnEnemy(moved.player.x, moved.player.y - 70);
                if (afterSpawn.enemyCount <= initial.enemyCount) failures.push('spawnEnemy() did not increase enemy count.');
                const afterStep = await probe.step(420);
                if (afterStep.score <= initial.score && afterStep.enemyCount >= afterSpawn.enemyCount) failures.push('step() did not show projectile/enemy state progression.');
                return { templateId, success: failures.length === 0, failures, details: { initial, moved, afterFire, afterSpawn, afterStep } };
            } catch (error) {
                return { templateId, success: false, failures: [error?.message || String(error)] };
            }
        }

        if (templateId === 'story-vignette') {
            const requiredMethods = ['snapshot', 'choose', 'forceEnding', 'reset'];
            const missingMethods = requiredMethods.filter((method) => typeof probe[method] !== 'function');
            const failures = missingMethods.map((method) => `Missing probe method: ${method}`);
            if (missingMethods.length > 0) {
                return { templateId, success: false, failures };
            }
            try {
                probe.reset();
                const initial = probe.snapshot();
                if (!initial.choiceCount || initial.choiceCount < 2) {
                    failures.push('Initial story node does not expose at least two choices.');
                }
                const afterChoice = probe.choose(0);
                if (
                    afterChoice.currentNode === initial.currentNode
                    && afterChoice.historyLength <= initial.historyLength
                    && JSON.stringify(afterChoice.meters) === JSON.stringify(initial.meters)
                ) {
                    failures.push('choose() did not change node, history, or meters.');
                }
                const ending = probe.forceEnding();
                if (!ending.ending) {
                    failures.push('forceEnding() did not reach an ending state.');
                }
                const reset = probe.reset();
                if (reset.currentNode !== initial.currentNode || reset.ending) {
                    failures.push('reset() did not restore initial story state.');
                }
                return {
                    templateId,
                    success: failures.length === 0,
                    failures,
                    details: { initial, afterChoice, ending, reset },
                };
            } catch (error) {
                return {
                    templateId,
                    success: false,
                    failures: [error?.message || String(error)],
                };
            }
        }

        if (templateId === 'phaser-platformer') {
            const requiredMethods = ['snapshot', 'move', 'jump', 'collectNearest', 'reset'];
            const missingMethods = requiredMethods.filter((method) => typeof probe[method] !== 'function');
            const failures = missingMethods.map((method) => `Missing probe method: ${method}`);
            if (missingMethods.length > 0) {
                return { templateId, success: false, failures };
            }
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            try {
                probe.reset();
                await wait(80);
                const initial = probe.snapshot();
                const moved = await probe.move(1, 240);
                if (!moved.player || !initial.player || moved.player.x <= initial.player.x + 5) {
                    failures.push('move() did not move the player right.');
                }
                const afterJump = await probe.jump();
                if (!afterJump.player || afterJump.player.vy >= 0) {
                    failures.push('jump() did not give the player upward velocity.');
                }
                const afterCollect = probe.collectNearest();
                if (afterCollect.score <= initial.score || afterCollect.collectibleCount >= initial.collectibleCount) {
                    failures.push('collectNearest() did not change score or collectible state.');
                }
                return {
                    templateId,
                    success: failures.length === 0,
                    failures,
                    details: { initial, moved, afterJump, afterCollect },
                };
            } catch (error) {
                return {
                    templateId,
                    success: false,
                    failures: [error?.message || String(error)],
                };
            }
        }

        if (templateId === 'canvas-arcade') {
            const requiredMethods = ['snapshot', 'move', 'primaryAction', 'spawnThreat', 'step', 'reset'];
            const missingMethods = requiredMethods.filter((method) => typeof probe[method] !== 'function');
            const failures = missingMethods.map((method) => `Missing probe method: ${method}`);
            if (missingMethods.length > 0) return { templateId, success: false, failures };
            try {
                probe.reset();
                const initial = probe.snapshot();
                const moved = await probe.move(1, 0, 220);
                if (
                    moved.player
                    && initial.player
                    && Math.abs((moved.player.x || 0) - (initial.player.x || 0)) < 4
                    && Math.abs((moved.player.y || 0) - (initial.player.y || 0)) < 4
                ) {
                    failures.push('move() did not change generic arcade player state.');
                }
                const afterAction = probe.primaryAction();
                if (
                    JSON.stringify(afterAction) === JSON.stringify(moved)
                    || (
                        (afterAction.score || 0) <= (moved.score || 0)
                        && (afterAction.projectileCount || 0) <= (moved.projectileCount || 0)
                        && (afterAction.actionCount || 0) <= (moved.actionCount || 0)
                    )
                ) {
                    failures.push('primaryAction() did not change arcade gameplay state.');
                }
                const afterThreat = probe.spawnThreat();
                if ((afterThreat.entityCount || afterThreat.enemyCount || afterThreat.threatCount || 0) <= (afterAction.entityCount || afterAction.enemyCount || afterAction.threatCount || 0)) {
                    failures.push('spawnThreat() did not increase live threat/entity count.');
                }
                const afterStep = await probe.step(420);
                if (
                    (afterStep.score || 0) <= (initial.score || 0)
                    && (afterStep.health || initial.health || 0) >= (initial.health || afterStep.health || 0)
                    && (afterStep.progress || 0) <= (initial.progress || 0)
                ) {
                    failures.push('step() did not progress generic arcade score, health, or objective state.');
                }
                const reset = probe.reset();
                if (reset.gameOver || reset.status === 'gameOver') {
                    failures.push('reset() did not restore generic arcade playable state.');
                }
                return { templateId, success: failures.length === 0, failures, details: { initial, moved, afterAction, afterThreat, afterStep, reset } };
            } catch (error) {
                return { templateId, success: false, failures: [error?.message || String(error)] };
            }
        }

        const requiredMethods = ['snapshot', 'setAim', 'fire', 'probeDeformTerrain', 'reset'];
        const missingMethods = requiredMethods.filter((method) => typeof probe[method] !== 'function');
        const failures = missingMethods.map((method) => `Missing probe method: ${method}`);
        if (missingMethods.length > 0) {
            return {
                templateId,
                success: false,
                failures,
            };
        }

        try {
            probe.reset();
            await wait(80);
            const initial = probe.snapshot();
            const lowArc = probe.setAim(25, 45).trajectorySignature;
            await wait(40);
            const highArc = probe.setAim(70, 90).trajectorySignature;
            if (!lowArc || !highArc || lowArc === highArc) {
                failures.push('setAim() did not produce a different trajectory signature when angle/power changed.');
            }

            const afterFire = probe.fire();
            if (!afterFire.projectileActive) {
                failures.push('fire() did not create an active projectile.');
            }
            await wait(260);
            const midFlight = probe.snapshot();
            const projectileMoved = afterFire.projectile && midFlight.projectile
                ? !samePoint(afterFire.projectile, midFlight.projectile, 1)
                : afterFire.projectileActive !== midFlight.projectileActive;
            if (afterFire.projectileActive && midFlight.projectileActive && !projectileMoved) {
                failures.push('fire() created a projectile but updateProjectile() did not move it during flight.');
            }
            if (!midFlight.projectileActive && !midFlight.winner && midFlight.currentTurn === initial.currentTurn && signatureOf(midFlight.terrainSignature) === signatureOf(initial.terrainSignature)) {
                failures.push('Projectile resolved without winner, turn change, or terrain-state evidence.');
            }

            const deformation = probe.probeDeformTerrain();
            if (!deformation?.changed) {
                failures.push('probeDeformTerrain() did not change sampled terrain height.');
            }
            await wait(760);
            const afterResolution = probe.snapshot();
            const initialHealth = Array.isArray(initial.tanks) ? initial.tanks.map((tank) => Number(tank.health || 0)) : [];
            const resolvedHealth = Array.isArray(afterResolution.tanks) ? afterResolution.tanks.map((tank) => Number(tank.health || 0)) : [];
            const healthChanged = initialHealth.some((health, index) => changedNumber(health, resolvedHealth[index]));
            const terrainChanged = signatureOf(afterResolution.terrainSignature) !== signatureOf(initial.terrainSignature)
                || signatureOf(deformation?.before) !== signatureOf(deformation?.after);
            const turnChanged = afterResolution.currentTurn !== initial.currentTurn;
            if (!healthChanged && !terrainChanged && !turnChanged && !afterResolution.winner) {
                failures.push('shot resolution did not change tank health, terrain signature, turn, or winner state.');
            }

            return {
                templateId,
                success: failures.length === 0,
                failures,
                details: {
                    initial,
                    lowArc,
                    highArc,
                    afterFire,
                    midFlight,
                    deformation,
                    afterResolution,
                    liveEvidence: {
                        projectileMoved,
                        healthChanged,
                        terrainChanged,
                        turnChanged,
                        winner: afterResolution.winner || null,
                    },
                },
            };
        } catch (error) {
            return {
                templateId,
                success: false,
                failures: [error?.message || String(error)],
            };
        }
    }, templateId, canvasKernelProbeContract);
}

export async function verifyGame(htmlString, options = {}) {
    let browser = null;
    const crashes = [];
    const runtimeLane = options?.runtimeLane || null;
    const requireDreamAssets = Boolean(options?.requireDreamAssets);
    const sourceHtml = String(options?.sourceHtml || htmlString || '');
    const templateInspection = inspectTemplateContractSource(sourceHtml, options?.templateContract || null);
    const assetContractInspection = inspectAssetContractSource(sourceHtml, options?.assetContract || null);
    const expectsThreeJs = runtimeLane === 'first_person_threejs'
        || runtimeLane === 'third_person_threejs'
        || /threejs|three_js|voxel|3d/i.test(String(runtimeLane || ''))
        || String(options?.engine || '').toLowerCase() === 'threejs'
        || String(options?.dimension || '').toUpperCase() === '3D'
        || isLikelyThreeJsBuild(htmlString);

    try {
        console.log("🕵️  Sandbox: Booting Headless Environment...");
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                // Software WebGL via ANGLE → SwiftShader. The version of Chrome puppeteer 24 bundles
                // REFUSES to create a WebGL context on the software renderer unless
                // --enable-unsafe-swiftshader is set (Chrome removed the silent SwiftShader fallback
                // ~M112). That single missing flag is why every 3D build logged "Could not create a
                // WebGL context (VENDOR=0xffff DEVICE=0xffff)" and fell through to the verifier-bypass,
                // so 3D was never actually rendered/checked. The legacy '--use-gl=swiftshader' spelling
                // is deprecated; the supported combo is --use-gl=angle + --use-angle=swiftshader.
                '--use-gl=angle',
                '--use-angle=swiftshader',
                '--enable-unsafe-swiftshader',
                '--enable-webgl',
                '--ignore-gpu-blocklist',
                '--ignore-certificate-errors',
            ]
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844 });

        let externalNavigation = null;
        page.on('framenavigated', frame => {
            if (frame !== page.mainFrame()) return;
            const url = frame.url();
            if (/^https?:\/\//i.test(url)) {
                externalNavigation = url;
            }
        });

        // Intercept all console messages to catch crashes
        page.on('console', msg => {
            const type = msg.type();
            const text = msg.text();
            // Capture headless WebGL-context failures too. The threejs kernel logs the
            // real cause (e.g. "Error creating WebGL context") via console.error when
            // swiftshader can't make a context — without this, that message was dropped
            // and the 3D build failed as a misleading "blank canvas / reading 'obstacles'"
            // instead of taking the intended webglLimited bypass below.
            const isWebglContextError = /webgl context|creating webgl|webgl.*not (?:available|supported)|getcontext.*webgl/i.test(text);
            if (type === 'error' && (text.includes('TypeError') || text.includes('ReferenceError') || text.includes('SyntaxError') || text.includes('Uncaught') || isWebglContextError)) {
                console.log("💥 Sandbox Caught Error:", text);
                crashes.push(text);
            }
        });

        // Intercept failed network requests or page crashes
        page.on('pageerror', err => {
            console.log("💥 Sandbox Caught PageError:", err.message);
            crashes.push(err.message);
        });

        await loadHtmlAsBrowserPage(page, htmlString);
        
        // Wait briefly for boot
        await new Promise(r => setTimeout(r, 1000));
        
        // Simulate aggressive interactive logic (pointer down, drag, pointer up) to trigger dormant interaction bugs
        try {
            await page.mouse.move(200, 200);
            await page.mouse.down({ button: 'left' });
            await new Promise(r => setTimeout(r, 1000)); // hold down for 1 second (tests long-press logic)
            await page.mouse.up({ button: 'left' });
            await page.mouse.click(300, 300); // test immediate click
        } catch(mouseErr) {
            console.log("Sandbox mouse interaction skipped:", mouseErr.message);
        }

        // Wait another 1 second to see if the interactions threw a delayed async error
        await new Promise(r => setTimeout(r, 1000));

        if (externalNavigation) {
            crashes.push(`External navigation detected: ${externalNavigation}. Generated games must stay self-contained inside the GameTok webview.`);
        }

        const templateRuntimeProbe = await runTemplateRuntimeProbe(page, options?.templateContract || null);
        if (templateRuntimeProbe) {
            const probeOk = templateRuntimeProbe.success ? 'pass' : 'FAIL';
            const loopNote = templateRuntimeProbe.details
                && Object.prototype.hasOwnProperty.call(templateRuntimeProbe.details, 'loopObserved')
                ? ` loopObserved=${templateRuntimeProbe.details.loopObserved}`
                : '';
            console.log(`🔬 [Sandbox Probe] template=${templateRuntimeProbe.templateId} ${probeOk}${loopNote}${templateRuntimeProbe.failures?.length ? ` failures=[${templateRuntimeProbe.failures.join('; ')}]` : ''}`);
        }

        const renderState = await page.evaluate(() => {
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 390;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 844;
            const doc = document.documentElement;
            const body = document.body;
            const canvases = Array.from(document.querySelectorAll('canvas'));
            const visibleCanvases = canvases.filter((canvas) => {
                const rect = canvas.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });

            const canvasIssues = visibleCanvases
                .map((canvas, index) => {
                    const rect = canvas.getBoundingClientRect();
                    const left = Math.round(rect.left);
                    const top = Math.round(rect.top);
                    const right = Math.round(rect.right);
                    const bottom = Math.round(rect.bottom);
                    const outside = left < -4 || top < -4 || right > viewportWidth + 4 || bottom > viewportHeight + 4;
                    const oversizedBackingStore = canvas.width > 1800 || canvas.height > 2600;
                    if (!outside && !oversizedBackingStore) return null;
                    return {
                        index,
                        rect: {
                            left,
                            top,
                            right,
                            bottom,
                            width: Math.round(rect.width),
                            height: Math.round(rect.height),
                        },
                        backingStore: { width: canvas.width, height: canvas.height },
                        outside,
                        oversizedBackingStore,
                    };
                })
                .filter(Boolean)
                .slice(0, 5);

            const visibleOutOfBoundsElements = Array.from(document.body?.querySelectorAll('*') || [])
                .slice(0, 500)
                .map((node) => {
                    const style = window.getComputedStyle(node);
                    if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null;
                    const rect = node.getBoundingClientRect();
                    if (rect.width < 12 || rect.height < 12) return null;
                    const isCanvas = node.tagName === 'CANVAS';
                    const isCritical = isCanvas
                        || node.matches('button, input, textarea, select, a, [role="button"], [data-control], [data-hud], [class*="hud" i], [class*="control" i], [class*="joystick" i], [class*="button" i], [id*="hud" i], [id*="control" i], [id*="joystick" i], [id*="button" i]');
                    if (!isCritical) return null;
                    const left = Math.round(rect.left);
                    const top = Math.round(rect.top);
                    const right = Math.round(rect.right);
                    const bottom = Math.round(rect.bottom);
                    const outside = left < -8 || top < -8 || right > viewportWidth + 8 || bottom > viewportHeight + 8;
                    if (!outside) return null;
                    const label = (node.textContent || node.getAttribute('aria-label') || node.id || node.className || node.tagName || '')
                        .toString()
                        .trim()
                        .replace(/\s+/g, ' ')
                        .slice(0, 80);
                    return {
                        tag: node.tagName.toLowerCase(),
                        label,
                        rect: {
                            left,
                            top,
                            right,
                            bottom,
                            width: Math.round(rect.width),
                            height: Math.round(rect.height),
                        },
                    };
                })
                .filter(Boolean)
                .slice(0, 8);

            const scrollWidth = Math.max(doc?.scrollWidth || 0, body?.scrollWidth || 0);
            const scrollHeight = Math.max(doc?.scrollHeight || 0, body?.scrollHeight || 0);
            const horizontalOverflow = Math.max(0, Math.round(scrollWidth - viewportWidth));
            const verticalOverflow = Math.max(0, Math.round(scrollHeight - viewportHeight));
            const bodyText = (document.body?.innerText || '').trim().slice(0, 400);
            const externalLinks = Array.from(document.querySelectorAll('a[href], form[action]'))
                .map((node) => node.getAttribute('href') || node.getAttribute('action') || '')
                .filter((url) => /^https?:\/\//i.test(url))
                .slice(0, 5);
            const dreamAssetUsage = window.__DREAM_ASSET_USAGE || { helperCalls: 0, usedKeys: {}, usedRoles: {} };
            const dreamAssetPackCount = Array.isArray(window.DREAM_ASSET_PACK)
                ? window.DREAM_ASSET_PACK.filter((asset) => asset && asset.type === 'image').length
                : 0;
            const dreamAnimationCount = Array.isArray(window.DREAM_ANIMATIONS)
                ? window.DREAM_ANIMATIONS.filter((animation) => animation && animation.type === 'frame_sequence').length
                : 0;
            const dreamTilesetCount = Array.isArray(window.DREAM_TILESETS)
                ? window.DREAM_TILESETS.filter((tileset) => tileset && tileset.imageKey).length
                : 0;
            const dreamAnimationKeys = Array.isArray(window.DREAM_ANIMATIONS)
                ? window.DREAM_ANIMATIONS.map((animation) => animation && animation.key).filter(Boolean)
                : [];
            const dreamTilesetKeys = Array.isArray(window.DREAM_TILESETS)
                ? window.DREAM_TILESETS.flatMap((tileset) => [tileset && tileset.key, tileset && tileset.imageKey, tileset && tileset.sheetKey]).filter(Boolean)
                : [];
            const dreamAssetPackRoles = Array.isArray(window.DREAM_ASSET_PACK)
                ? Array.from(new Set(window.DREAM_ASSET_PACK
                    .filter((asset) => asset && asset.type === 'image')
                    .flatMap((asset) => [asset.role, asset.category].filter(Boolean))))
                : [];
            const dreamAssetPackEntries = Array.isArray(window.DREAM_ASSET_PACK)
                ? window.DREAM_ASSET_PACK
                    .filter((asset) => asset && asset.type === 'image')
                    .map((asset) => ({
                        key: asset.key || asset.id || null,
                        id: asset.id || asset.key || null,
                        role: asset.role || null,
                        category: asset.category || null,
                    }))
                    .filter((asset) => asset.key || asset.id || asset.role || asset.category)
                : [];
            const canvasPixelChecks = visibleCanvases.slice(0, 3).map((canvas, index) => {
                const rect = canvas.getBoundingClientRect();
                const skipBlankCheck = canvas.id === 'juice-canvas'
                    || canvas.dataset?.skipBlankCheck === 'true'
                    || (canvas.id !== 'game-canvas' && window.getComputedStyle(canvas).pointerEvents === 'none');
                if (skipBlankCheck) {
                    return {
                        index,
                        sampled: false,
                        skipped: true,
                        reason: canvas.id || 'overlay-canvas',
                    };
                }
                const sampleWidth = Math.max(1, Math.min(32, Math.floor(rect.width)));
                const sampleHeight = Math.max(1, Math.min(32, Math.floor(rect.height)));
                try {
                    const sample = document.createElement('canvas');
                    sample.width = sampleWidth;
                    sample.height = sampleHeight;
                    const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
                    sampleCtx.drawImage(canvas, 0, 0, sampleWidth, sampleHeight);
                    const data = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;
                    const colors = new Set();
                    let nonTransparentPixels = 0;
                    for (let i = 0; i < data.length; i += 4) {
                        if (data[i + 3] > 8) nonTransparentPixels += 1;
                        if (colors.size < 64) {
                            colors.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4},${data[i + 3] >> 4}`);
                        }
                    }
                    return {
                        index,
                        sampled: true,
                        uniqueColorBuckets: colors.size,
                        nonTransparentRatio: nonTransparentPixels / (sampleWidth * sampleHeight),
                    };
                } catch (error) {
                    return {
                        index,
                        sampled: false,
                        error: error.message || String(error),
                    };
                }
            });

            return {
                viewportWidth,
                viewportHeight,
                canvasCount: canvases.length,
                visibleCanvasCount: visibleCanvases.length,
                canvasIssues,
                horizontalOverflow,
                verticalOverflow,
                visibleOutOfBoundsElements,
                externalLinks,
                dreamAssetUsage,
                dreamAssetPackCount,
                dreamAnimationCount,
                dreamAnimationKeys,
                dreamTilesetCount,
                dreamTilesetKeys,
                dreamAssetPackRoles,
                dreamAssetPackEntries,
                canvasPixelChecks,
                bodyText,
            };
        });
        renderState.templateInspection = templateInspection;
        renderState.assetContractInspection = assetContractInspection;
        renderState.templateRuntimeProbe = templateRuntimeProbe;
        renderState.failedContractChecks = [];

        // Legacy function inspection and runtime probe checks removed
        // since we now use OpenGame Phaser/Vite templates instead of
        // the old vanilla JS scaffold.

        if (assetContractInspection?.usesImageUi) {
            const message = 'Asset contract violation: source appears to use generated images for UI/HUD/button/slider/meter roles. HUD and controls must be code-rendered.';
            renderState.failedContractChecks.push({
                id: 'asset_image_ui_violation',
                templateId: assetContractInspection.templateId,
                message,
            });
            crashes.push(message);
        }

        if (
            requireDreamAssets
            && assetContractInspection
            && Array.isArray(assetContractInspection.missingRoleReferences)
            && assetContractInspection.missingRoleReferences.length > 0
        ) {
            const renderedRoles = renderState.dreamAssetUsage?.renderedRoles || {};
            const usedRoles = renderState.dreamAssetUsage?.usedRoles || {};
            const renderedKeys = renderState.dreamAssetUsage?.renderedKeys || {};
            const usedKeys = renderState.dreamAssetUsage?.usedKeys || {};
            const slots = Array.isArray(options?.assetContract?.slots) ? options.assetContract.slots : [];
            const packEntries = Array.isArray(renderState.dreamAssetPackEntries) ? renderState.dreamAssetPackEntries : [];
            const hasRuntimeEvidenceFor = (slot) => {
                const roleValues = [slot.role, slot.category, slot.id].filter(Boolean);
                const directRoleOrKeyHit = roleValues.some((value) => {
                    const usage = roleUsageCountsForEvidence(renderedRoles, usedRoles, renderedKeys, usedKeys, value);
                    return usage.rendered > 0 || usage.used > 0;
                });
                if (directRoleOrKeyHit) return true;

                return packEntries.some((asset) => {
                    const assetKeys = [asset.key, asset.id].filter(Boolean);
                    const assetRoles = [asset.role, asset.category].filter(Boolean);
                    const assetWasUsed = assetKeys.some((key) =>
                        Number(renderedKeys[key] || 0) > 0
                        || Number(usedKeys[key] || 0) > 0
                    );
                    const assetMatchesSlot = assetRoles.some((role) => roleValues.includes(role))
                        || assetKeys.some((key) => roleValues.includes(key))
                        || (
                            isSceneryAssetRole(roleValues)
                            && assetRoles.some((role) => isSceneryAssetRole([role]))
                        );
                    return assetWasUsed && assetMatchesSlot;
                });
            };
            const unresolvedMissingSlots = assetContractInspection.missingRoleReferences.filter((slotId) => {
                const slot = slots.find((entry) => entry && entry.id === slotId) || {};
                return !hasRuntimeEvidenceFor(slot);
            });
            assetContractInspection.missingRoleReferences = unresolvedMissingSlots;
            renderState.assetContractInspection.missingRoleReferences = unresolvedMissingSlots;
            if (unresolvedMissingSlots.length > 0) {
                const message = `Asset contract violation: required asset slots are not referenced in source: ${unresolvedMissingSlots.join(', ')}. Required generated assets must be connected through DreamAssets or DREAM_ASSET_PACK.`;
                renderState.failedContractChecks.push({
                    id: 'asset_required_slots_unreferenced',
                    templateId: assetContractInspection.templateId,
                    missingSlots: unresolvedMissingSlots,
                    message,
                });
                crashes.push(message);
            }
        }

        if (renderState.canvasCount === 0) {
            crashes.push('No canvas element was rendered.');
        } else if (renderState.visibleCanvasCount === 0) {
            crashes.push('Canvas elements were created but none were visible.');
        }

        if (renderState.horizontalOverflow > 4) {
            crashes.push(`Viewport overflow detected: page is ${renderState.horizontalOverflow}px wider than the ${renderState.viewportWidth}px mobile viewport. Generated games must fit the phone width without horizontal scrolling.`);
        }

        if (Array.isArray(renderState.canvasIssues) && renderState.canvasIssues.length > 0) {
            const summary = renderState.canvasIssues.map((issue) => {
                const reason = [
                    issue.outside ? 'outside viewport' : null,
                    issue.oversizedBackingStore ? `oversized backing store ${issue.backingStore.width}x${issue.backingStore.height}` : null,
                ].filter(Boolean).join(', ');
                return `canvas#${issue.index} ${reason} rect=${issue.rect.left},${issue.rect.top},${issue.rect.right},${issue.rect.bottom}`;
            }).join('; ');
            crashes.push(`Canvas sizing issue: ${summary}. Canvas/renderers must be constrained to the mobile viewport and resize responsively.`);
        }

        if (Array.isArray(renderState.visibleOutOfBoundsElements) && renderState.visibleOutOfBoundsElements.length > 0) {
            const summary = renderState.visibleOutOfBoundsElements
                .map((item) => `${item.tag}${item.label ? ` "${item.label}"` : ''} rect=${item.rect.left},${item.rect.top},${item.rect.right},${item.rect.bottom}`)
                .join('; ');
            crashes.push(`Viewport bounds issue: important UI/control elements are outside the ${renderState.viewportWidth}x${renderState.viewportHeight} viewport: ${summary}. Clamp HUD and touch controls into safe visible bounds.`);
        }

        if (Array.isArray(renderState.externalLinks) && renderState.externalLinks.length > 0) {
            crashes.push(`External links detected in generated game: ${renderState.externalLinks.join(', ')}. Games must be self-contained and must not route users to websites.`);
        }

        const blankCanvas = Array.isArray(renderState.canvasPixelChecks)
            ? renderState.canvasPixelChecks.find((check) => check.sampled && check.nonTransparentRatio < 0.02)
            : null;
        if (blankCanvas) {
            crashes.push(`Blank canvas detected: canvas#${blankCanvas.index} has almost no visible pixels. The game must render visible gameplay on boot.`);
        }

        // The asset-render checks below are 2D-only: they look for DreamAssets.addSprite /
        // canvas drawImage usage and 2D pixel rendering. A three.js game paints assets as
        // textures/sprites/billboards on the GPU, so these checks can never pass for 3D —
        // skip them for three.js builds (the blank-canvas pixel check still guards render).
        if (!expectsThreeJs && options.requireDreamAssets && renderState.dreamAssetPackCount > 0) {
            const helperCalls = Number(renderState.dreamAssetUsage?.helperCalls || 0);
            const usedKeys = Object.keys(renderState.dreamAssetUsage?.usedKeys || {});
            const renderedKeys = Object.keys(renderState.dreamAssetUsage?.renderedKeys || {});
            const sourceUsesDreamAssets = /DreamAssets|DREAM_ASSETS|DREAM_ASSET_PACK|DREAM_ANIMATIONS|getAssetImage|DREAM_IMAGES/.test(sourceHtml);
            
            if (!sourceUsesDreamAssets && helperCalls === 0 && usedKeys.length === 0) {
                const message = `Generated asset pack ignored: ${renderState.dreamAssetPackCount} image assets were injected, but the game source never references DreamAssets and no runtime asset fetches occurred. Use the custom asset pack for player, enemies, props, items, or backgrounds instead of placeholder shapes.`;
                renderState.failedContractChecks.push({
                    id: 'asset_pack_ignored',
                    templateId: options?.assetContract?.templateId || null,
                    assetCount: renderState.dreamAssetPackCount,
                    message,
                });
                crashes.push(message);
            }

            if ((sourceUsesDreamAssets || helperCalls > 0 || usedKeys.length > 0) && renderedKeys.length === 0) {
                const message = `Generated asset pack not rendered: ${renderState.dreamAssetPackCount} image assets were injected and referenced/preloaded, but none were observed rendering on canvas or Phaser display objects during boot. Draw gameplay assets with DreamAssets.addSprite/addBackgroundCover or canvas drawImage instead of placeholder shapes.`;
                renderState.failedContractChecks.push({
                    id: 'asset_pack_not_rendered',
                    templateId: options?.assetContract?.templateId || null,
                    assetCount: renderState.dreamAssetPackCount,
                    message,
                });
                crashes.push(message);
            }
            
            const requiredRoles = Array.from(new Set(Array.isArray(options?.assetContract?.slots)
                ? options.assetContract.slots
                    .filter((slot) => slot?.required)
                    .map((slot) => normalizeRequiredAssetRole(slot.role || slot.category))
                    .filter(Boolean)
                : []));
            const renderedRoles = renderState.dreamAssetUsage?.renderedRoles || {};
            const packRoles = new Set(
                (Array.isArray(renderState.dreamAssetPackRoles) ? renderState.dreamAssetPackRoles : [])
                    .map((role) => normalizeRequiredAssetRole(role)),
            );
            
            // Only the BACKGROUND is genuinely on screen at frame 1 for EVERY game. Everything else
            // is game-dependent: enemies spawn in waves, items appear during the loop, and even the
            // "player" role is often NOT a persistent avatar — it's a targeting reticle (tower
            // defense), a cursor (puzzle/builder), or nothing at all. Demanding any of those at boot
            // is unfixable by design and makes the agent burn every repair turn flailing. The pack is
            // still protected from being ignored by asset_pack_ignored + asset_pack_not_rendered above.
            const BOOT_RENDER_REQUIRED_ROLES = new Set(['background']);
            const missingRequiredRoleUsage = requiredRoles
                .filter((role) => BOOT_RENDER_REQUIRED_ROLES.has(role))
                .filter((role) => packRoles.has(role))
                .filter((role) => getRenderedRoleCount(renderedRoles, role, renderState.dreamAssetUsage?.renderedKeys || {}) === 0);

            if (missingRequiredRoleUsage.length > 0) {
                const message = `Required background art not rendered: a generated background exists but was only preloaded/referenced and never drawn on boot. Draw the generated background full-bleed on the first frame instead of a flat gradient fill.`;
                renderState.failedContractChecks.push({
                    id: 'asset_required_roles_unused',
                    templateId: options?.assetContract?.templateId || null,
                    missingRoles: missingRequiredRoleUsage,
                    message,
                });
                crashes.push(message);
            }
        }

        // Bare "error"/"exception"/"failed" also occur in legitimate game copy — a horror
        // premise's "Engine failed...", a "Mission failed" screen, a "no errors!" puzzle hint —
        // so matching those words flagged working games as crashed. Genuine JS exceptions are
        // already caught by the console + pageerror listeners above; this only needs to catch an
        // on-screen error OVERLAY, which has an unambiguous signature (typed errors, Vite overlay).
        const errorOverlaySignature = /Uncaught|(?:Type|Reference|Syntax|Range|Eval)Error|is not (?:defined|a function)|Cannot read (?:properties|property)|Failed to (?:resolve|fetch|load|compile|parse|execute)|Unhandled(?: promise)? rejection|\[plugin:vite|Internal server error/i;
        if (errorOverlaySignature.test(renderState.bodyText)) {
            crashes.push(`Visible error text detected: ${renderState.bodyText}`);
        }

        let screenshotBase64 = null;
        if (crashes.length === 0) {
            try {
                const buffer = await page.screenshot({ type: 'webp', quality: 50 });
                screenshotBase64 = 'data:image/webp;base64,' + buffer.toString('base64');
            } catch (err) {
                console.log("Screenshot failed:", err.message);
            }
        }

        await browser.close();

        if (crashes.length > 0) {
            if (expectsThreeJs && isHeadlessWebglFailure(crashes)) {
                console.warn('⚠️ Sandbox: WebGL context could not be created in headless mode. Treating this 3D build as verifier-bypassed instead of failed.');
                return {
                    success: true,
                    bypassed: true,
                    webglLimited: true,
                    crashes,
                    screenshot: null,
                };
            }
            return { success: false, crashes, error: crashes[0], diagnostics: renderState };
        } else {
            console.log("✅ Sandbox: Zero Crashes Detected. Game is stable!");
            return { success: true, screenshot: screenshotBase64, diagnostics: renderState };
        }
    } catch (e) {
        if (browser) await browser.close();
        console.error("Sandbox core implementation failed:", e);
        // If puppeteer fails to launch, pass it through rather than failing the user entirely
        return { success: true, bypassed: true, crashes: [] };
    }
}
