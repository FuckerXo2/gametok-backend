const fs = require('fs');
const file = '/Users/abiolalimitless/gameidea/gametok-backend/src/ai-engine/routes.js';
let code = fs.readFileSync(file, 'utf8');

// 1. Add currentModel to requestBuilderMessage
code = code.replace(
    /async function requestBuilderMessage\(userPrompt, \{ label, jobId = null, timeoutMs = BUILDER_REQUEST_TIMEOUT_MS, maxAttempts = 3 \} = \{\}\) \{/,
    "async function requestBuilderMessage(userPrompt, { label, jobId = null, timeoutMs = BUILDER_REQUEST_TIMEOUT_MS, maxAttempts = 3, currentModel = null } = {}) {"
);

code = code.replace(
    /const text = await withNvidiaRetries\(async \(currentModel\) => withAbortableTimeout\(async \(signal\) => \{/,
    "const text = await withNvidiaRetries(async (modelParam) => withAbortableTimeout(async (signal) => {\n        const modelToUse = currentModel || modelParam || DREAM_MODELS.premiumBuilder;"
);

code = code.replace(
    /console\.log\(`⏳ \[\$\{logLabel\}\] Requesting builder output \(timeout \$\{Math\.round\(timeoutMs \/ 1000\)\}s, model: \$\{currentModel \|\| DREAM_MODELS\.premiumBuilder\}\)\.\.\.`\);/,
    "console.log(`⏳ [${logLabel}] Requesting builder output (timeout ${Math.round(timeoutMs / 1000)}s, model: ${modelToUse})...`);"
);

code = code.replace(
    /\.\.\.getNvidiaChatOptions\(currentModel \|\| DREAM_MODELS\.premiumBuilder, BUILDER_MAX_TOKENS\),/,
    "...getNvidiaChatOptions(modelToUse, BUILDER_MAX_TOKENS),"
);

// 2. Add currentModel to generateCompleteHtmlWithBuilder
code = code.replace(
    /async function generateCompleteHtmlWithBuilder\(initialPrompt, \{ label, jobId = null \} = \{\}\) \{/,
    "async function generateCompleteHtmlWithBuilder(initialPrompt, { label, jobId = null, currentModel = null } = {}) {"
);

code = code.replace(
    /let \{ text, stopReason \} = await requestBuilderMessage\(initialPrompt, \{ label, jobId \}\);/,
    "let { text, stopReason } = await requestBuilderMessage(initialPrompt, { label, jobId, currentModel });"
);

code = code.replace(
    /const continuation = await requestBuilderMessage\(continuationPrompt, \{\n\s*label: `\$\{label\} Continue`,\n\s*jobId,\n\s*timeoutMs: BUILDER_CONTINUATION_TIMEOUT_MS,\n\s*maxAttempts: 2,\n\s*\}\);/,
    `const continuation = await requestBuilderMessage(continuationPrompt, {
            label: \`\${label} Continue\`,
            jobId,
            timeoutMs: BUILDER_CONTINUATION_TIMEOUT_MS,
            maxAttempts: 2,
            currentModel,
        });`
);

// 3. Add currentModel to generateCompleteJsonWithBuilder
code = code.replace(
    /async function generateCompleteJsonWithBuilder\(initialPrompt, \{ label, jobId = null, timeoutMs = BUILDER_REQUEST_TIMEOUT_MS, maxAttempts = 2, progressBase = 56 \} = \{\}\) \{/,
    "async function generateCompleteJsonWithBuilder(initialPrompt, { label, jobId = null, timeoutMs = BUILDER_REQUEST_TIMEOUT_MS, maxAttempts = 2, progressBase = 56, currentModel = null } = {}) {"
);

code = code.replace(
    /let \{ text, stopReason \} = await requestBuilderMessage\(prompt, \{\n\s*label: currentLabel,\n\s*jobId,\n\s*timeoutMs,\n\s*maxAttempts,\n\s*\}\);/,
    `let { text, stopReason } = await requestBuilderMessage(prompt, {
            label: currentLabel,
            jobId,
            timeoutMs,
            maxAttempts,
            currentModel,
        });`
);

code = code.replace(
    /const continuation = await requestBuilderMessage\(buildBuilderJsonContinuationPrompt\(jsonText, parseError\), \{\n\s*label: `\$\{currentLabel\} JSON Continue`,\n\s*jobId,\n\s*timeoutMs: BUILDER_CONTINUATION_TIMEOUT_MS,\n\s*maxAttempts: 2,\n\s*\}\);/,
    `const continuation = await requestBuilderMessage(buildBuilderJsonContinuationPrompt(jsonText, parseError), {
                    label: \`\${currentLabel} JSON Continue\`,
                    jobId,
                    timeoutMs: BUILDER_CONTINUATION_TIMEOUT_MS,
                    maxAttempts: 2,
                    currentModel,
                });`
);


// 4. Update Phase 2 File Agent Logic
const p2Search = `                    const agentJsonText = await generateCompleteJsonWithBuilder(promptText, {
                        label: \`Phase 2 File Agent Turn \${fileAgentTurnCount}\`,
                        jobId,
                        timeoutMs: BUILDER_CONTINUATION_TIMEOUT_MS,
                        maxAttempts: 2,
                        progressBase: progress,
                    });`;

const p2Replace = `                    let turnSuccess = false;
                    for (let m = 0; m < BUILDER_FALLBACK_MODELS.length; m++) {
                        const mModel = BUILDER_FALLBACK_MODELS[m];
                        try {
                            const agentJsonText = await generateCompleteJsonWithBuilder(promptText, {
                                label: \`Phase 2 File Agent Turn \${fileAgentTurnCount}\`,
                                jobId,
                                timeoutMs: BUILDER_CONTINUATION_TIMEOUT_MS,
                                maxAttempts: 2,
                                progressBase: progress,
                                currentModel: mModel,
                            });
                            // success
                            var __AGENT_JSON_TEXT__ = agentJsonText;
                            turnSuccess = true;
                            break;
                        } catch(e) {
                            console.error(\`⚠️ [Maker Agent] \${mModel} failed turn: \${e.message}\`);
                        }
                    }
                    if (!turnSuccess) throw new Error("All models failed Phase 2 File Agent Turn JSON.");
                    const agentJsonText = __AGENT_JSON_TEXT__;`;

code = code.replace(p2Search, p2Replace);


// 5. Update Phase 3 File Repair Logic
const p3Search = `                        const repairText = await generateCompleteJsonWithBuilder(fileRepairPrompt, {
                            label: 'Phase 3 File Repair',
                            jobId,
                            timeoutMs: BUILDER_CONTINUATION_TIMEOUT_MS,
                            maxAttempts: 2,
                            progressBase: 78 + repairAttempt,
                        });`;

const p3Replace = `                        let turnSuccess = false;
                        for (let m = 0; m < BUILDER_FALLBACK_MODELS.length; m++) {
                            const mModel = BUILDER_FALLBACK_MODELS[m];
                            try {
                                const repairText = await generateCompleteJsonWithBuilder(fileRepairPrompt, {
                                    label: 'Phase 3 File Repair',
                                    jobId,
                                    timeoutMs: BUILDER_CONTINUATION_TIMEOUT_MS,
                                    maxAttempts: 2,
                                    progressBase: 78 + repairAttempt,
                                    currentModel: mModel,
                                });
                                var __REPAIR_TEXT__ = repairText;
                                turnSuccess = true;
                                break;
                            } catch(e) {
                                console.error(\`⚠️ [Phase 3 Repair] \${mModel} failed repair JSON: \${e.message}\`);
                            }
                        }
                        if (!turnSuccess) throw new Error("All models failed Phase 3 File Repair JSON.");
                        const repairText = __REPAIR_TEXT__;`;

code = code.replace(p3Search, p3Replace);


// 6. Update P3 crash error to not throw
const crashSearch = `            throw new Error([
                \`Sandbox verification failed after \${repairAttemptsUsed} builder repair attempts.\`,
                \`Last failure: \${finalCrash}\`,
                finalTasks.length ? \`Targeted repair tasks: \${finalTasks.join(' | ')}\` : null,
            ].filter(Boolean).join(' '));`;

const crashReplace = `            console.error(\`⚠️ Sandbox verification failed after \${repairAttemptsUsed} builder repair attempts.\`);
            console.error(\`⚠️ Last failure: \${finalCrash}\`);
            if (finalTasks.length) {
                console.error(\`⚠️ Targeted repair tasks: \${finalTasks.join(' | ')}\`);
            }
            console.warn(\`⚠️ The user requested to RETURN THE BROKEN GAME INSTEAD OF GIVING UP. Continuing to save...\`);`;

code = code.replace(crashSearch, crashReplace);


// 7. Update Edit flow repair error to not throw
const editCrashSearch = `            throw new Error([
                \`Edit verification failed.\`,
                \`Last failure: \${finalEditCrash}\`
            ].filter(Boolean).join(' '));`;

const editCrashReplace = `            console.error(\`⚠️ Edit verification failed after repairs.\`);
            console.error(\`⚠️ Last failure: \${finalEditCrash}\`);
            console.warn(\`⚠️ The user requested to RETURN THE BROKEN GAME INSTEAD OF GIVING UP. Continuing to save the edited game...\`);`;

code = code.replace(editCrashSearch, editCrashReplace);

fs.writeFileSync(file, code);
console.log("Done");
