const fs = require('fs');
const file = '/Users/abiolalimitless/gameidea/gametok-backend/src/ai-engine/routes.js';
let code = fs.readFileSync(file, 'utf8');

// 1. Update the prompt to ask for XML
code = code.replace(
    /'Return JSON only\. No markdown\. No commentary\.',\s*'Schema:',\s*'\{"files":\[\{"path":"index\.html","content":"complete replacement file contents"\}\],"notes":\["short note"\]\}',/,
    `'Return XML tags only. No markdown formatting blocks (\`\`\`). No commentary.',
        'Schema:',
        '<notes>Explain what you are fixing</notes>',
        '<file path="src/game.js">',
        '// complete file contents here',
        '</file>',`
);

// 2. Add parseMakerXmlResponse below parseMakerFileRepairResponse
const xmlParser = `
function parseMakerXmlResponse(text) {
    const files = [];
    const fileRegex = /<file path="([^"]+)">([\\s\\S]*?)<\\/file>/g;
    let match;
    while ((match = fileRegex.exec(text)) !== null) {
        files.push({ path: match[1], content: match[2].trim() });
    }
    const notesRegex = /<notes>([\\s\\S]*?)<\\/notes>/;
    const notesMatch = notesRegex.exec(text);
    const notes = notesMatch ? [notesMatch[1].trim()] : [];
    
    if (files.length === 0) {
        throw new Error('File repair response did not include any <file> tags.');
    }
    
    return { files, notes };
}

async function generateCompleteXmlWithBuilder(initialPrompt, { label, jobId = null, timeoutMs = BUILDER_REQUEST_TIMEOUT_MS, maxAttempts = 2, progressBase = 56, currentModel = null } = {}) {
    assertJobNotCancelled(jobId);
    let { text, stopReason } = await requestBuilderMessage(initialPrompt, { label, jobId, timeoutMs, maxAttempts, currentModel });
    
    let continuationCount = 0;
    // Check if it was truncated (missing closing </file> but has an open <file)
    while ((stopReason !== 'stop' && stopReason !== 'finish' && stopReason !== 'end_turn') && continuationCount < BUILDER_MAX_CONTINUATIONS) {
        const unclosedFile = /<file path="[^"]+">(?![\\s\\S]*<\\/file>)/.test(text);
        if (!unclosedFile && /<\\/file>$/.test(text.trim())) {
            break; // Looks closed enough
        }
        
        continuationCount++;
        console.warn(\`⚠️ [\${label}] XML output incomplete. Requesting continuation \${continuationCount}/\${BUILDER_MAX_CONTINUATIONS}...\`);
        const continuation = await requestBuilderMessage("Continue exactly from where you left off. Do not repeat code. Do not apologize. Just output the next characters.", {
            label: \`\${label} XML Continue\`,
            jobId,
            timeoutMs: BUILDER_CONTINUATION_TIMEOUT_MS,
            maxAttempts: 2,
            currentModel,
        });
        text += continuation.text;
        stopReason = continuation.stopReason;
    }
    
    return text;
}
`;

code = code.replace(
    /function parseMakerFileRepairResponse\(text\) \{/,
    xmlParser + '\nfunction parseMakerFileRepairResponse(text) {'
);

// 3. Update Phase 3 repair logic to use XML
code = code.replace(
    /const repairText = await generateCompleteJsonWithBuilder\(fileRepairPrompt, \{/g,
    "const repairText = await generateCompleteXmlWithBuilder(fileRepairPrompt, {"
);

code = code.replace(
    /const repair = parseMakerFileRepairResponse\(repairText\);/g,
    "const repair = parseMakerXmlResponse(repairText);"
);

code = code.replace(
    /failed repair JSON:/g,
    "failed repair XML:"
);

code = code.replace(
    /throw new Error\("All models failed Phase 3 File Repair JSON\."\);/g,
    'throw new Error("All models failed Phase 3 File Repair XML.");'
);

fs.writeFileSync(file, code);
console.log("Done patching to XML!");
