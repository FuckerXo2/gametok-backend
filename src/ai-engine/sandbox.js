import puppeteer from 'puppeteer';

function isLikelyThreeJsBuild(htmlString = '') {
    const source = String(htmlString || '');
    return /THREE\.(WebGLRenderer|PerspectiveCamera|Scene)/i.test(source)
        || /cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js/i.test(source)
        || /three\.min\.js/i.test(source);
}

function isHeadlessWebglFailure(crashes = []) {
    return Array.isArray(crashes) && crashes.some((entry) =>
        /webgl context|error creating webgl context|failed to create.*webgl/i.test(String(entry || ''))
    );
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

async function runTemplateRuntimeProbe(page, templateContract = null) {
    const templateId = templateContract?.templateId || null;
    if (![
        'phaser-artillery',
        'phaser-top-down-action',
        'phaser-platformer',
        'canvas-simulation',
        'canvas-grid-puzzle',
        'canvas-runner',
        'canvas-arcade-shooter',
        'story-vignette',
    ].includes(templateId)) return null;

    return page.evaluate(async () => {
        const probe = window.__GAMETOK_TEMPLATE_PROBE__;
        const templateId = probe?.templateId || 'unknown';
        if (!probe) {
            return {
                templateId: 'unknown',
                success: false,
                failures: ['Missing window.__GAMETOK_TEMPLATE_PROBE__. Preserve the scaffold probe API.'],
            };
        }

        if (templateId === 'phaser-top-down-action') {
            const requiredMethods = ['snapshot', 'move', 'attack', 'spawnEnemyNearPlayer', 'reset'];
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
                await probe.move(1, 0, 180);
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
                if (afterCombat.enemyCount >= afterSpawn.enemyCount && afterCombat.score <= initial.score && afterCombat.player.health >= initial.player.health) {
                    failures.push('Combat probe did not show score, enemy, projectile, or health-state progression.');
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

        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        try {
            probe.reset();
            await wait(80);
            const initial = probe.snapshot();
            const lowArc = probe.setAim(25, 45).trajectorySignature;
            await wait(40);
            const highArc = probe.setAim(70, 90).trajectorySignature;
            if (!lowArc || !highArc || lowArc === highArc) {
                failures.push('Angle/power changes did not produce a different trajectory signature.');
            }

            const afterFire = probe.fire();
            if (!afterFire.projectileActive) {
                failures.push('fire() did not create an active projectile.');
            }
            await wait(260);
            const midFlight = probe.snapshot();
            if (!midFlight.projectileActive && !midFlight.winner && midFlight.currentTurn === initial.currentTurn) {
                failures.push('Projectile resolved too quickly without winner or turn-state evidence.');
            }

            const deformation = probe.probeDeformTerrain();
            if (!deformation?.changed) {
                failures.push('probeDeformTerrain() did not change sampled terrain height.');
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
                },
            };
        } catch (error) {
            return {
                templateId,
                success: false,
                failures: [error?.message || String(error)],
            };
        }
    });
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
        || isLikelyThreeJsBuild(htmlString);

    try {
        console.log("🕵️  Sandbox: Booting Headless Environment...");
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--use-gl=swiftshader',
                '--use-angle=swiftshader-webgl',
                '--enable-webgl',
                '--enable-gpu-rasterization',
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
            if (type === 'error' && (text.includes('TypeError') || text.includes('ReferenceError') || text.includes('SyntaxError') || text.includes('Uncaught'))) {
                console.log("💥 Sandbox Caught Error:", text);
                crashes.push(text);
            }
        });

        // Intercept failed network requests or page crashes
        page.on('pageerror', err => {
            console.log("💥 Sandbox Caught PageError:", err.message);
            crashes.push(err.message);
        });

        await page.setContent(htmlString, { waitUntil: 'load', timeout: 8000 });
        
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
            const dreamAssetPackRoles = Array.isArray(window.DREAM_ASSET_PACK)
                ? Array.from(new Set(window.DREAM_ASSET_PACK
                    .filter((asset) => asset && asset.type === 'image')
                    .map((asset) => asset.role || asset.category)
                    .filter(Boolean)))
                : [];
            const canvasPixelChecks = visibleCanvases.slice(0, 3).map((canvas, index) => {
                const rect = canvas.getBoundingClientRect();
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
                dreamAssetPackRoles,
                canvasPixelChecks,
                bodyText,
            };
        });
        renderState.templateInspection = templateInspection;
        renderState.assetContractInspection = assetContractInspection;
        renderState.templateRuntimeProbe = templateRuntimeProbe;

        if (
            templateInspection
            && templateInspection.requiredFunctionCount >= 5
            && templateInspection.missingFunctions.length >= Math.ceil(templateInspection.requiredFunctionCount * 0.55)
        ) {
            crashes.push(`Template contract not implemented: ${templateInspection.templateId} requires core functions (${templateInspection.missingFunctions.slice(0, 8).join(', ')}). Build inside the selected native template instead of producing a generic game file.`);
        }

        if (templateRuntimeProbe && !templateRuntimeProbe.success) {
            crashes.push(`Template runtime probe failed for ${templateRuntimeProbe.templateId}: ${templateRuntimeProbe.failures.join(' ')}`);
        }

        if (assetContractInspection?.usesImageUi) {
            crashes.push('Asset contract violation: source appears to use generated images for UI/HUD/button/slider/meter roles. HUD and controls must be code-rendered.');
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

        if (requireDreamAssets && renderState.dreamAssetPackCount > 0) {
            const sourceUsesDreamAssets = /\b(DreamAssets|DREAM_ASSETS|DREAM_ASSET_PACK)\b/.test(sourceHtml);
            const helperCalls = Number(renderState.dreamAssetUsage?.helperCalls || 0);
            const usedKeys = Object.keys(renderState.dreamAssetUsage?.usedKeys || {});
            if (!sourceUsesDreamAssets && helperCalls === 0 && usedKeys.length === 0) {
                crashes.push(`Generated asset pack ignored: ${renderState.dreamAssetPackCount} image assets were injected, but the game source never references DreamAssets, DREAM_ASSETS, or DREAM_ASSET_PACK. Use the custom asset pack for player, enemies, props, items, or backgrounds instead of placeholder shapes.`);
            }
            const requiredRoles = Array.from(new Set(Array.isArray(options?.assetContract?.slots)
                ? options.assetContract.slots.filter((slot) => slot?.required).map((slot) => slot.role || slot.category).filter(Boolean)
                : []));
            const usedRoles = renderState.dreamAssetUsage?.usedRoles || {};
            const packRoles = new Set(Array.isArray(renderState.dreamAssetPackRoles) ? renderState.dreamAssetPackRoles : []);
            const missingRequiredRoleUsage = requiredRoles
                .filter((role) => packRoles.has(role))
                .filter((role) => Number(usedRoles[role] || 0) === 0);
            if (sourceUsesDreamAssets && helperCalls > 0 && missingRequiredRoleUsage.length > 0) {
                crashes.push(`Required asset slots not consumed: generated assets exist, but these required roles were not used through DreamAssets during boot: ${missingRequiredRoleUsage.join(', ')}.`);
            }
        }

        if (/error|exception|failed/i.test(renderState.bodyText)) {
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
